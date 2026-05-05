import path from "node:path";
import { db } from "../db.js";
import { datasets, scrapeJobs, datasetRows, containers, aiPipelines } from "../../../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { startPipelineRun, completePipelineRun, failPipelineRun } from "./store.js";
import { generateSchema, persistSchemaToDisk, applySchemaToJobDb, renderDrizzleSchema } from "./schema-gen.js";
import { runDataTransform } from "./data-transform.js";
import { generateCrudRoutes, renderRouteFile, persistRoutesToDisk } from "./route-gen.js";
import { buildAndSpawnHonoService } from "./hono-builder.js";
import { getAiSettings, type Provider, PROVIDERS } from "./llm-client.js";
import type { ParseMode } from "../ai-parser.js";
import type { PipelineRun, SchemaSpec, RouteSet } from "./types.js";

const JOBS_DIR = path.join(process.cwd(), "jobs");

async function getDatasetDbCredentials(datasetId: number): Promise<{ password: string; user: string; dbName: string } | null> {
  const [row] = await db.select({
    password: containers.password,
    user: containers.dbUser,
    dbName: containers.dbName
  })
    .from(containers)
    .where(eq(containers.datasetId, datasetId))
    .orderBy(desc(containers.id))
    .limit(1);
  return row ?? null;
}

export async function runPipeline(jobId: number, opts: { mode?: ParseMode } = {}): Promise<PipelineRun> {
  const settings = await getAiSettings();
  if (!settings) throw new Error("No AI provider configured. Set one in Settings.");

  const provider = settings.provider as Provider;
  const apiKey = settings.apiKey;
  const model = PROVIDERS[provider].model;

  const result: PipelineRun = { jobId };

  // Phase 2 first: data transform (also creates dataset + dataset DB).
  // We need rows before asking the AI to design a schema.
  const dataRun = await startPipelineRun({
    jobId, phase: "data", provider, model, inputSummary: { mode: opts.mode ?? settings.mode }
  });
  let dataResult;
  try {
    dataResult = await runDataTransform({
      jobId, provider, apiKey, parseMode: opts.mode ?? settings.mode
    });
    await completePipelineRun(dataRun.id, { output: { ...dataResult } });
    result.dataPipelineId = dataRun.id;
  } catch (err) {
    await failPipelineRun(dataRun.id, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // Poll datasets row until databasePort is set or timeout (runDataTransform spawns DB fire-and-forget).
  const datasetRow = await waitForDatasetDb(dataResult.datasetId, 30000);
  if (!datasetRow) {
    throw new Error(`Dataset ${dataResult.datasetId} DB did not become ready within 30s`);
  }

  // Phase 1: schema-gen, using rows we just created.
  const schemaRun = await startPipelineRun({
    jobId, phase: "schema", provider, model,
    inputSummary: { datasetId: dataResult.datasetId, rowCount: dataResult.rowCount }
  });

  let schemaSpec: SchemaSpec;
  try {
    const sample = await db
      .select({ data: datasetRows.data })
      .from(datasetRows)
      .where(eq(datasetRows.datasetId, dataResult.datasetId))
      .orderBy(datasetRows.rowIndex)
      .limit(20)
      .then(rows => rows.map(r => r.data as Record<string, unknown>));

    const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).limit(1);
    const suggestedTableName = job?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `job_${jobId}`;

    schemaSpec = await generateSchema({
      jobId, provider, apiKey, model,
      sampleRows: sample,
      suggestedTableName
    });
    persistSchemaToDisk(jobId, schemaSpec, JOBS_DIR);

    if (datasetRow.databasePort) {
      const creds = await getDatasetDbCredentials(dataResult.datasetId);
      if (!creds) throw new Error(`No container row found for dataset ${dataResult.datasetId}`);
      const url = `postgres://${creds.user}:${encodeURIComponent(creds.password)}@localhost:${datasetRow.databasePort}/${creds.dbName}`;
      await applySchemaToJobDb(url, schemaSpec);
    }
    await completePipelineRun(schemaRun.id, { output: { schemaSpec } });
    result.schemaPipelineId = schemaRun.id;
  } catch (err) {
    await failPipelineRun(schemaRun.id, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // Phase 3: route-gen.
  const apiRun = await startPipelineRun({
    jobId, phase: "api", provider, model,
    inputSummary: { tables: schemaSpec.tables.map(t => t.name) }
  });

  let routeSet: RouteSet;
  let routeSource = "";
  try {
    routeSet = await generateCrudRoutes({ provider, apiKey, model, schemaSpec });
    routeSource = renderRouteFile(routeSet, schemaSpec);
    persistRoutesToDisk(jobId, routeSet.resource, routeSource, JOBS_DIR);
    await completePipelineRun(apiRun.id, { output: { routeSet } });
    result.apiPipelineId = apiRun.id;
  } catch (err) {
    await failPipelineRun(apiRun.id, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // Build + spawn Hono container.
  if (datasetRow.databaseContainerId) {
    // Connect via host port using host.docker.internal so the Hono container can reach the
    // dataset DB. On Docker Desktop this resolves automatically; on Linux it requires
    // --add-host=host.docker.internal:host-gateway in the Hono container run args.
    // TODO(follow-up): if host.docker.internal doesn't resolve, look up container hostname
    // from the `containers` table (slug prefix: scrapekit-db-) and use scrapekit-net instead.
    const creds = await getDatasetDbCredentials(dataResult.datasetId);
    if (!creds) throw new Error(`No container row found for dataset ${dataResult.datasetId}`);
    const dbUrl = `postgres://${creds.user}:${encodeURIComponent(creds.password)}@host.docker.internal:${datasetRow.databasePort}/${creds.dbName}`;
    const generatedSchemaSource = renderDrizzleSchema(schemaSpec);
    const built = await buildAndSpawnHonoService({
      jobId,
      jobsDir: JOBS_DIR,
      schemaSource: generatedSchemaSource,
      jobDbConnectionUrl: dbUrl
    });
    result.honoServiceId = built.honoServiceId;
  }

  return result;
}

async function waitForDatasetDb(
  datasetId: number,
  timeoutMs: number
): Promise<{ databasePort: number | null; databaseContainerId: string | null } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [row] = await db.select({
      databasePort: datasets.databasePort,
      databaseContainerId: datasets.databaseContainerId,
      databaseStatus: datasets.databaseStatus
    }).from(datasets).where(eq(datasets.id, datasetId)).limit(1);
    if (row && row.databasePort && row.databaseContainerId && row.databaseStatus === "running") {
      return { databasePort: row.databasePort, databaseContainerId: row.databaseContainerId };
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

export async function rerunPhase(jobId: number, phase: "schema" | "data" | "api"): Promise<void> {
  // Selective re-run. Each phase can be re-run only if its prerequisites still exist.
  if (phase === "data") {
    // Re-run data forces re-running schema and api too (they depend on dataset rows)
    await runPipeline(jobId);
    return;
  }

  // For 'schema' or 'api' rerun, find the latest dataset for this job; reuse its DB.
  const settings = await getAiSettings();
  if (!settings) throw new Error("No AI provider configured. Set one in Settings.");
  const provider = settings.provider as Provider;
  const apiKey = settings.apiKey;
  const model = PROVIDERS[provider].model;

  const [latestDataset] = await db.select().from(datasets)
    .where(eq(datasets.sourceJobId, jobId))
    .orderBy(desc(datasets.id))
    .limit(1);
  if (!latestDataset) throw new Error(`No dataset found for job ${jobId}; run the data phase first`);

  const datasetRow = await waitForDatasetDb(latestDataset.id, 30000);
  if (!datasetRow) throw new Error(`Dataset DB for ${latestDataset.id} not ready`);
  const creds = await getDatasetDbCredentials(latestDataset.id);
  if (!creds) throw new Error(`No container credentials for dataset ${latestDataset.id}`);

  if (phase === "schema") {
    const schemaRun = await startPipelineRun({
      jobId, phase: "schema", provider, model, inputSummary: { datasetId: latestDataset.id, rerun: true }
    });
    try {
      const sample = await db.select({ data: datasetRows.data })
        .from(datasetRows)
        .where(eq(datasetRows.datasetId, latestDataset.id))
        .orderBy(datasetRows.rowIndex)
        .limit(20)
        .then(rows => rows.map(r => r.data as Record<string, unknown>));
      const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).limit(1);
      const suggested = job?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `job_${jobId}`;
      const schemaSpec = await generateSchema({ jobId, provider, apiKey, model, sampleRows: sample, suggestedTableName: suggested });
      persistSchemaToDisk(jobId, schemaSpec, JOBS_DIR);
      if (datasetRow.databasePort) {
        const url = `postgres://${creds.user}:${encodeURIComponent(creds.password)}@localhost:${datasetRow.databasePort}/${creds.dbName}`;
        await applySchemaToJobDb(url, schemaSpec);
      }
      await completePipelineRun(schemaRun.id, { output: { schemaSpec } });
    } catch (err) {
      await failPipelineRun(schemaRun.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
    return;
  }

  if (phase === "api") {
    // Need the latest schema spec (from completed schema-phase run for this job).
    const [latestSchemaRun] = await db.select().from(aiPipelines)
      .where(and(eq(aiPipelines.jobId, jobId), eq(aiPipelines.phase, "schema"), eq(aiPipelines.status, "completed")))
      .orderBy(desc(aiPipelines.id))
      .limit(1);
    if (!latestSchemaRun || !latestSchemaRun.output) {
      throw new Error("No completed schema run found; run the schema phase first");
    }
    const schemaSpec = (latestSchemaRun.output as { schemaSpec: SchemaSpec }).schemaSpec;
    if (!schemaSpec) throw new Error("Schema run output missing schemaSpec");

    const apiRun = await startPipelineRun({
      jobId, phase: "api", provider, model, inputSummary: { tables: schemaSpec.tables.map(t => t.name), rerun: true }
    });
    try {
      const routeSet = await generateCrudRoutes({ provider, apiKey, model, schemaSpec });
      const routeSource = renderRouteFile(routeSet, schemaSpec);
      persistRoutesToDisk(jobId, routeSet.resource, routeSource, JOBS_DIR);
      await completePipelineRun(apiRun.id, { output: { routeSet } });
    } catch (err) {
      await failPipelineRun(apiRun.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
    return;
  }

  throw new Error(`Unknown phase: ${phase}`);
}
