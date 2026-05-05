import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { runPipeline, rerunPhase } from "../lib/ai-pipeline/pipeline.js";
import { listPipelineRunsForJob, getPipelineRun } from "../lib/ai-pipeline/store.js";
import { destroyHonoService } from "../lib/ai-pipeline/hono-builder.js";
import { honoServices as honoServicesTable, datasets } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { db } from "../lib/db.js";
import { destroyJobDatabase } from "../lib/docker-manager.js";

const app = new Hono();

const RunBody = z.object({
  mode: z.enum(["general", "ecommerce", "articles", "contacts", "real_estate", "jobs"]).optional()
});

app.post("/jobs/:id/pipeline", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid job id" }, 400);

  const bodyRaw = await c.req.json().catch(() => ({}));
  const parsed = RunBody.safeParse(bodyRaw);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  try {
    const result = await runPipeline(id, parsed.data);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/jobs/:id/pipeline/:phase/rerun", async (c) => {
  const id = Number(c.req.param("id"));
  const phase = c.req.param("phase");
  if (!["schema", "data", "api"].includes(phase)) return c.json({ error: "Invalid phase" }, 400);
  await rerunPhase(id, phase as "schema" | "data" | "api");
  return c.json({ ok: true });
});

app.get("/jobs/:id/pipeline", async (c) => {
  const id = Number(c.req.param("id"));
  const runs = await listPipelineRunsForJob(id);
  return c.json(runs);
});

app.get("/pipeline-runs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const run = await getPipelineRun(id);
  if (!run) return c.json({ error: "Not found" }, 404);
  return c.json(run);
});

app.delete("/jobs/:id/api", async (c) => {
  const jobId = Number(c.req.param("id"));
  if (!Number.isInteger(jobId) || jobId <= 0) return c.json({ error: "Invalid job id" }, 400);

  const services = await db.select().from(honoServicesTable).where(eq(honoServicesTable.jobId, jobId));
  for (const s of services) await destroyHonoService(s.id);

  // Destroy latest dataset DB for this job
  const [ds] = await db.select().from(datasets)
    .where(eq(datasets.sourceJobId, jobId))
    .orderBy(desc(datasets.id))
    .limit(1);
  if (ds?.databaseContainerId) {
    await destroyJobDatabase(ds.databaseContainerId).catch(() => { /* ignore */ });
  }

  // Remove on-disk artifacts
  const jobDir = path.join(process.cwd(), "jobs", String(jobId));
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }

  return c.json({ ok: true, services: services.length, datasetCleaned: !!ds, diskCleaned: true });
});

export default app;
