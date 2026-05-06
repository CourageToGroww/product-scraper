import postgres from "postgres";
import { db } from "../db.js";
import { datasets, containers as containersTable } from "../../../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { ensureNetwork } from "../network.js";
import { spawnDatasetDatabase } from "../docker-manager.js";
import { startMergeRun, completeMergeRun, failMergeRun, getMerge } from "./merge-store.js";

interface SourceCreds {
  datasetId: number;
  hostInNetwork: string;
  port: number;
  user: string;
  password: string;
  dbName: string;
}

async function loadSourceCreds(datasetIds: number[]): Promise<SourceCreds[]> {
  const dsRows = await db.select().from(datasets).where(inArray(datasets.id, datasetIds));
  const containerRows = await db.select().from(containersTable).where(inArray(containersTable.datasetId, datasetIds));

  const result: SourceCreds[] = [];
  for (const ds of dsRows) {
    const container = containerRows
      .filter(c => c.datasetId === ds.id)
      .sort((a, b) => b.id - a.id)[0];
    if (!container) throw new Error(`No container row for dataset ${ds.id}`);
    if (!ds.databasePort) throw new Error(`Dataset ${ds.id} has no running DB`);
    const hostInNetwork = `scrapekit-db-${container.slug}`;
    result.push({
      datasetId: ds.id,
      hostInNetwork,
      port: 5432,
      user: container.dbUser,
      password: container.password,
      dbName: container.dbName
    });
  }
  return result;
}

export async function runMerge(mergeId: number): Promise<{ targetContainerId: number; rowCounts: Record<string, number> }> {
  await ensureNetwork();
  const merge = await getMerge(mergeId);
  if (!merge) throw new Error(`Merge ${mergeId} not found`);

  await startMergeRun(mergeId);

  try {
    const sources = await loadSourceCreds(merge.sourceDatasetIds);
    if (sources.length === 0) throw new Error("No source datasets");

    const target = await spawnDatasetDatabase(mergeId, `merge-${mergeId}`, [], []);

    const [targetContainer] = await db.select().from(containersTable)
      .where(eq(containersTable.containerId, target.containerId)).limit(1);
    if (!targetContainer) throw new Error("Target container row not found after spawn");
    await db.update(containersTable)
      .set({ type: "merge-target", datasetId: null })
      .where(eq(containersTable.id, targetContainer.id));

    const targetUrl = `postgres://${targetContainer.dbUser}:${encodeURIComponent(targetContainer.password)}@localhost:${target.port}/${targetContainer.dbName}`;
    const sql = postgres(targetUrl, { max: 1 });

    const rowCounts: Record<string, number> = {};

    try {
      await sql`CREATE EXTENSION IF NOT EXISTS postgres_fdw`;

      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        const serverName = `src_${i}`;
        const remoteSchema = `src_${i}`;

        await sql.unsafe(`DROP SCHEMA IF EXISTS ${remoteSchema} CASCADE`);
        await sql.unsafe(`DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER ${serverName}`);
        await sql.unsafe(`DROP SERVER IF EXISTS ${serverName} CASCADE`);

        await sql.unsafe(
          `CREATE SERVER ${serverName} FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host '${s.hostInNetwork}', port '${s.port}', dbname '${s.dbName}')`
        );
        await sql.unsafe(
          `CREATE USER MAPPING FOR CURRENT_USER SERVER ${serverName} OPTIONS (user '${s.user}', password '${s.password}')`
        );
        await sql.unsafe(`CREATE SCHEMA ${remoteSchema}`);
        await sql.unsafe(`IMPORT FOREIGN SCHEMA public FROM SERVER ${serverName} INTO ${remoteSchema}`);
      }

      const srcSchemas = sources.map((_, i) => `src_${i}`);
      const tableRows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ANY(${srcSchemas as unknown as string[]})
        GROUP BY table_name HAVING COUNT(DISTINCT table_schema) = ${sources.length}
      `;
      const sharedTables = tableRows.map(r => r.table_name);

      for (const t of sharedTables) {
        await sql.unsafe(`CREATE TABLE IF NOT EXISTS public."${t}" (LIKE src_0."${t}" INCLUDING DEFAULTS)`);
        let count = 0;
        for (let i = 0; i < sources.length; i++) {
          const result = await sql.unsafe(`INSERT INTO public."${t}" SELECT * FROM src_${i}."${t}"`);
          count += (result as unknown as { count: number }).count ?? 0;
        }
        rowCounts[t] = count;
      }

      for (let i = 0; i < sources.length; i++) {
        await sql.unsafe(`DROP SCHEMA IF EXISTS src_${i} CASCADE`);
        await sql.unsafe(`DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER src_${i}`);
        await sql.unsafe(`DROP SERVER IF EXISTS src_${i} CASCADE`);
      }
    } finally {
      await sql.end();
    }

    await completeMergeRun(mergeId, { rowCounts, targetContainerId: targetContainer.id });
    return { targetContainerId: targetContainer.id, rowCounts };
  } catch (err) {
    await failMergeRun(mergeId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
