import { db } from "./db.js";
import { containers } from "../../db/schema.js";
import { eq, ne } from "drizzle-orm";

type ContainerType = "job-db" | "job-api" | "dataset-db" | "standalone" | "merge-target" | "main-db";
type ContainerStatus = "creating" | "running" | "stopped" | "error" | "destroyed";

export interface InsertContainerInput {
  slug: string;
  name: string;
  type: ContainerType;
  port: number;
  password: string;
  jobId: number | null;
  datasetId: number | null;
  dataPath: string | null;
  containerId?: string | null;
  network?: string;
  dbUser?: string;
  dbName?: string;
}

export async function insertContainer(input: InsertContainerInput) {
  const [row] = await db
    .insert(containers)
    .values({
      slug: input.slug,
      name: input.name,
      type: input.type,
      port: input.port,
      password: input.password,
      jobId: input.jobId,
      datasetId: input.datasetId,
      dataPath: input.dataPath,
      containerId: input.containerId ?? null,
      network: input.network ?? "scrapekit-net",
      dbUser: input.dbUser ?? "scrapekit",
      dbName: input.dbName ?? "scrapekit"
    })
    .returning();
  return row;
}

export async function getContainerBySlug(slug: string) {
  const [row] = await db.select().from(containers).where(eq(containers.slug, slug)).limit(1);
  return row ?? null;
}

export async function listContainers(opts: { includeDestroyed?: boolean } = {}) {
  if (opts.includeDestroyed) {
    return db.select().from(containers);
  }
  return db.select().from(containers).where(ne(containers.status, "destroyed"));
}

export async function updateContainerStatus(slug: string, status: ContainerStatus) {
  await db
    .update(containers)
    .set({
      status,
      destroyedAt: status === "destroyed" ? new Date() : null
    })
    .where(eq(containers.slug, slug));
}

export async function updateContainerId(slug: string, containerId: string) {
  await db.update(containers).set({ containerId }).where(eq(containers.slug, slug));
}

export async function deleteContainer(slug: string) {
  await db.delete(containers).where(eq(containers.slug, slug));
}

export async function listUsedPorts(): Promise<number[]> {
  const rows = await db
    .select({ port: containers.port })
    .from(containers)
    .where(ne(containers.status, "destroyed"));
  return rows.map(r => r.port);
}
