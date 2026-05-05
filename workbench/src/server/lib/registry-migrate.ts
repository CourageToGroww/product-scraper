import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "./db.js";
import { containers } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const REGISTRY_FILE = path.join(os.homedir(), ".scrapekit", "registry.json");
const MIGRATED_MARKER = path.join(os.homedir(), ".scrapekit", ".registry-migrated");

interface LegacyEntry {
  id: string;
  name: string;
  port: number;
  containerId: string;
  status: "running" | "stopped" | "error";
  createdAt: string;
  dataPath: string;
  jobId?: number;
  datasetId?: number;
}

export async function migrateRegistryIfNeeded(): Promise<{ migrated: number; skipped: boolean }> {
  if (fs.existsSync(MIGRATED_MARKER)) return { migrated: 0, skipped: true };
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString());
    return { migrated: 0, skipped: true };
  }

  const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
  let entries: LegacyEntry[];
  try {
    entries = JSON.parse(raw);
  } catch {
    fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString());
    return { migrated: 0, skipped: true };
  }

  let migrated = 0;
  for (const entry of entries) {
    const [existing] = await db.select().from(containers).where(eq(containers.slug, entry.id)).limit(1);
    if (existing) continue;

    const type = entry.jobId
      ? "job-db"
      : entry.datasetId
      ? "dataset-db"
      : "standalone";

    await db.insert(containers).values({
      slug: entry.id,
      name: entry.name,
      type,
      port: entry.port,
      containerId: entry.containerId || null,
      status: entry.status === "error" ? "error" : entry.status,
      password: "scrapekit",
      jobId: entry.jobId ?? null,
      datasetId: entry.datasetId ?? null,
      dataPath: entry.dataPath,
      createdAt: new Date(entry.createdAt)
    });
    migrated++;
  }

  fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString());
  return { migrated, skipped: false };
}
