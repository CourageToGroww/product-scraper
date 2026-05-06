import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { db } from "../db.js";
import { datasets, containers } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";

const JOBS_DIR = path.join(process.cwd(), "jobs");
const STUDIO_PORT_MIN = 7500;
const STUDIO_PORT_MAX = 7999;

interface StudioProcess {
  jobId: number;
  port: number;
  proc: ChildProcess;
  startedAt: number;
}

const activeStudios = new Map<number, StudioProcess>();
const usedPorts = new Set<number>();

export async function launchStudioForJob(jobId: number): Promise<{ url: string; port: number }> {
  // Kill any existing studio for this job
  const existing = activeStudios.get(jobId);
  if (existing) {
    try { existing.proc.kill("SIGTERM"); } catch { /* ignore */ }
    usedPorts.delete(existing.port);
    activeStudios.delete(jobId);
  }

  const [ds] = await db.select().from(datasets)
    .where(eq(datasets.sourceJobId, jobId))
    .orderBy(desc(datasets.id)).limit(1);
  if (!ds || !ds.databasePort) throw new Error("Dataset DB not available");

  const [creds] = await db.select({
    user: containers.dbUser,
    password: containers.password,
    dbName: containers.dbName
  }).from(containers).where(eq(containers.datasetId, ds.id)).orderBy(desc(containers.id)).limit(1);
  if (!creds) throw new Error("Container credentials not found");

  const url = `postgres://${creds.user}:${encodeURIComponent(creds.password)}@localhost:${ds.databasePort}/${creds.dbName}`;

  // Generate a per-job drizzle.config.ts
  const jobDir = path.join(JOBS_DIR, String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });
  const cfgPath = path.join(jobDir, "drizzle.config.ts");
  fs.writeFileSync(cfgPath, `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: ${JSON.stringify(url)} }
});
`);

  // Pick a port
  let port = STUDIO_PORT_MIN;
  while (usedPorts.has(port) && port <= STUDIO_PORT_MAX) port++;
  if (port > STUDIO_PORT_MAX) throw new Error("No free studio port in 7500-7999");
  usedPorts.add(port);

  // Spawn drizzle-kit studio
  const proc = spawn("npx", ["drizzle-kit", "studio", "--port", String(port), "--host", "0.0.0.0", "--config", cfgPath], {
    cwd: process.cwd(),
    detached: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc.on("exit", () => {
    usedPorts.delete(port);
    activeStudios.delete(jobId);
  });

  activeStudios.set(jobId, { jobId, port, proc, startedAt: Date.now() });

  return { url: `http://localhost:${port}`, port };
}

export function killStudioForJob(jobId: number): boolean {
  const entry = activeStudios.get(jobId);
  if (!entry) return false;
  try { entry.proc.kill("SIGTERM"); } catch { /* ignore */ }
  usedPorts.delete(entry.port);
  activeStudios.delete(jobId);
  return true;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [jobId, entry] of activeStudios.entries()) {
    if (now - entry.startedAt > IDLE_TIMEOUT_MS) {
      try { entry.proc.kill("SIGTERM"); } catch { /* ignore */ }
      usedPorts.delete(entry.port);
      activeStudios.delete(jobId);
      console.log(`[studio-launcher] killed idle studio for job ${jobId}`);
    }
  }
}, 60_000).unref();
