import { db } from "../db.js";
import { aiPipelines } from "../../../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import type { Phase } from "./types.js";

export interface StartRunInput {
  jobId: number | null;
  phase: Phase;
  provider: string;
  model: string;
  inputSummary: Record<string, unknown>;
}

export async function startPipelineRun(input: StartRunInput) {
  const [row] = await db.insert(aiPipelines).values({
    jobId: input.jobId,
    phase: input.phase,
    provider: input.provider,
    model: input.model,
    status: "running",
    inputSummary: input.inputSummary,
    startedAt: new Date()
  }).returning();
  return row;
}

export async function completePipelineRun(id: number, args: { output: Record<string, unknown> }) {
  const [row] = await db.update(aiPipelines).set({
    status: "completed",
    output: args.output,
    completedAt: new Date()
  }).where(eq(aiPipelines.id, id)).returning();
  return row;
}

export async function failPipelineRun(id: number, errorMessage: string) {
  const [row] = await db.update(aiPipelines).set({
    status: "failed",
    errorMessage,
    completedAt: new Date()
  }).where(eq(aiPipelines.id, id)).returning();
  return row;
}

export async function getPipelineRun(id: number) {
  const [row] = await db.select().from(aiPipelines).where(eq(aiPipelines.id, id)).limit(1);
  return row ?? null;
}

export async function listPipelineRunsForJob(jobId: number) {
  return db.select().from(aiPipelines)
    .where(eq(aiPipelines.jobId, jobId))
    .orderBy(desc(aiPipelines.id));
}

export async function listPipelineRunsForJobAndPhase(jobId: number, phase: Phase) {
  return db.select().from(aiPipelines)
    .where(and(eq(aiPipelines.jobId, jobId), eq(aiPipelines.phase, phase)))
    .orderBy(desc(aiPipelines.id));
}
