import { db } from "../db.js";
import { merges } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";

export interface CreateMergeInput {
  name: string;
  description?: string;
  sourceDatasetIds: number[];
}

export async function createMerge(input: CreateMergeInput) {
  const [row] = await db.insert(merges).values({
    name: input.name,
    description: input.description,
    sourceDatasetIds: input.sourceDatasetIds,
    status: "pending"
  }).returning();
  return row;
}

export async function startMergeRun(id: number) {
  const [row] = await db.update(merges).set({ status: "running", startedAt: new Date() }).where(eq(merges.id, id)).returning();
  return row;
}

export async function completeMergeRun(id: number, args: { rowCounts: Record<string, number>; targetContainerId: number }) {
  const [row] = await db.update(merges).set({
    status: "completed", rowCounts: args.rowCounts,
    targetContainerId: args.targetContainerId, completedAt: new Date()
  }).where(eq(merges.id, id)).returning();
  return row;
}

export async function failMergeRun(id: number, errorMessage: string) {
  const [row] = await db.update(merges).set({ status: "failed", errorMessage, completedAt: new Date() }).where(eq(merges.id, id)).returning();
  return row;
}

export async function getMerge(id: number) {
  const [row] = await db.select().from(merges).where(eq(merges.id, id)).limit(1);
  return row ?? null;
}

export async function listMerges() {
  return db.select().from(merges).orderBy(desc(merges.id));
}

export async function deleteMerge(id: number) {
  await db.delete(merges).where(eq(merges.id, id));
}
