import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import { aiPipelines, scrapeJobs } from "../../../db/schema.js";
import { sql } from "drizzle-orm";
import {
  startPipelineRun,
  completePipelineRun,
  failPipelineRun,
  getPipelineRun,
  listPipelineRunsForJob
} from "./store.js";

if (process.env.NODE_ENV !== "test") {
  throw new Error("ai-pipeline/store.test.ts: refusing to run with NODE_ENV != 'test'");
}

describe("ai-pipeline store", () => {
  beforeEach(async () => {
    await db.delete(aiPipelines);
    // Ensure test job rows exist (FK target). Use raw SQL to override serial and skip conflicts.
    await db.execute(sql`
      INSERT INTO scrape_jobs (id, name, status, urls, config)
      VALUES (1, 'test-job-1', 'pending', '[]', '{}'),
             (7, 'test-job-7', 'pending', '[]', '{}')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  it("starts a pipeline run with status 'running' and timestamp", async () => {
    const run = await startPipelineRun({
      jobId: 1, phase: "schema", provider: "deepseek", model: "deepseek-v4-pro",
      inputSummary: { resultCount: 5 }
    });
    expect(run.status).toBe("running");
    expect(run.startedAt).toBeTruthy();
  });

  it("marks a run completed and stores output", async () => {
    const run = await startPipelineRun({
      jobId: 1, phase: "schema", provider: "deepseek", model: "deepseek-v4-pro",
      inputSummary: {}
    });
    const completed = await completePipelineRun(run.id, { output: { tables: [] } });
    expect(completed.status).toBe("completed");
    expect(completed.output).toEqual({ tables: [] });
  });

  it("marks a run failed and stores error", async () => {
    const run = await startPipelineRun({
      jobId: 1, phase: "data", provider: "deepseek", model: "deepseek-v4-pro",
      inputSummary: {}
    });
    const failed = await failPipelineRun(run.id, "boom");
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toBe("boom");
  });

  it("lists runs for a job in reverse chronological order", async () => {
    await startPipelineRun({ jobId: 7, phase: "schema", provider: "deepseek", model: "x", inputSummary: {} });
    await startPipelineRun({ jobId: 7, phase: "data", provider: "deepseek", model: "x", inputSummary: {} });
    const runs = await listPipelineRunsForJob(7);
    expect(runs.length).toBe(2);
    expect(runs[0].phase).toBe("data");
    expect(runs[1].phase).toBe("schema");
  });
});
