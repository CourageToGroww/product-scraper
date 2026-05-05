import path from "node:path";
import fs from "node:fs";
import { db } from "../db.js";
import { honoServices, datasets, containers } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { destroyHonoService, buildAndSpawnHonoService } from "./hono-builder.js";

const JOBS_DIR = path.join(process.cwd(), "jobs");

export async function rebuildHonoServiceForJob(jobId: number): Promise<{ honoServiceId: number; port: number }> {
  // Destroy any existing hono services for this job.
  const existing = await db.select().from(honoServices).where(eq(honoServices.jobId, jobId));
  for (const s of existing) {
    await destroyHonoService(s.id).catch(() => { /* ignore */ });
  }

  // Find the latest dataset and its DB credentials for the connection URL.
  const [ds] = await db.select().from(datasets)
    .where(eq(datasets.sourceJobId, jobId))
    .orderBy(desc(datasets.id)).limit(1);
  if (!ds || !ds.databasePort || !ds.databaseContainerId) {
    throw new Error("Dataset DB not available for this job");
  }

  const [creds] = await db.select({
    user: containers.dbUser,
    password: containers.password,
    dbName: containers.dbName
  }).from(containers).where(eq(containers.datasetId, ds.id)).orderBy(desc(containers.id)).limit(1);
  if (!creds) throw new Error("Container credentials not found for dataset");

  const dbUrl = `postgres://${creds.user}:${encodeURIComponent(creds.password)}@host.docker.internal:${ds.databasePort}/${creds.dbName}`;

  // Read the current schema spec from disk
  const schemaTsPath = path.join(JOBS_DIR, String(jobId), "schema.ts");
  if (!fs.existsSync(schemaTsPath)) {
    throw new Error(`Generated schema.ts not found for job ${jobId}; run pipeline first`);
  }
  const schemaSource = fs.readFileSync(schemaTsPath, "utf-8");

  const built = await buildAndSpawnHonoService({
    jobId,
    jobsDir: JOBS_DIR,
    schemaSource,
    jobDbConnectionUrl: dbUrl
  });
  return { honoServiceId: built.honoServiceId, port: built.port };
}
