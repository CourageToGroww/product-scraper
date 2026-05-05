import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { db } from "../db.js";
import { honoServices } from "../../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureNetwork } from "../network.js";
import { insertContainer, updateContainerId, updateContainerStatus } from "../container-store.js";

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "hono-service");

export interface HonoBuildInput {
  jobId: number;
  jobsDir: string;
  schemaSource: string;       // contents of generated schema.ts
  jobDbConnectionUrl: string; // postgres://scrapekit:<pw>@scrapekit-db-<slug>:5432/scrapekit
}

export interface HonoBuildResult {
  honoServiceId: number;
  imageTag: string;
  containerId: string;
  port: number;
  apiSlug: string;
}

export async function buildAndSpawnHonoService(input: HonoBuildInput): Promise<HonoBuildResult> {
  await ensureNetwork();
  const jobDir = path.join(input.jobsDir, String(input.jobId), "api");
  copyTemplate(jobDir);

  // Place generated schema.ts under api/src/
  fs.writeFileSync(path.join(jobDir, "src", "schema.ts"), input.schemaSource, "utf-8");
  // (Routes are written by Task 8's persistRoutesToDisk before this is called.)

  const slug = `job-${input.jobId}-api`;
  const containerName = `scrapekit-${slug}`;
  const imageTag = `scrapekit-${slug}:latest`;

  // Build image via shell `docker build`
  execSync(`docker build -t ${imageTag} ${jobDir}`, { stdio: "inherit" });

  // Allocate a host port (range 6500-6999 for job APIs)
  const port = await findAvailableApiPort();

  const password = crypto.randomBytes(8).toString("base64url");
  await insertContainer({
    slug,
    name: `Job #${input.jobId} API`,
    type: "job-api",
    port,
    password,
    jobId: input.jobId,
    datasetId: null,
    dataPath: jobDir,
  });

  let containerId = "";
  try {
    execSync(
      `docker run -d --name ${containerName} --network scrapekit-net ` +
        `-p ${port}:3001 -e DATABASE_URL=${JSON.stringify(input.jobDbConnectionUrl)} ${imageTag}`,
      { stdio: "pipe" }
    );
    containerId = execSync(`docker ps -q -f name=^${containerName}$`).toString().trim();
    await updateContainerId(slug, containerId);
    await updateContainerStatus(slug, "running");
  } catch (err) {
    await updateContainerStatus(slug, "error").catch(() => {
      // swallow secondary error
    });
    throw err;
  }

  const [serviceRow] = await db
    .insert(honoServices)
    .values({
      jobId: input.jobId,
      srcDir: jobDir,
      imageTag,
      port,
      status: "running",
      routesGenerated: countRouteFiles(jobDir),
    })
    .returning();

  return {
    honoServiceId: serviceRow.id,
    imageTag,
    containerId,
    port,
    apiSlug: slug,
  };
}

function copyTemplate(destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  copyRecursiveSync(TEMPLATE_DIR, destDir);
}

function copyRecursiveSync(src: string, dest: string) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyRecursiveSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

async function findAvailableApiPort(): Promise<number> {
  const used = await db
    .select({ port: honoServices.port })
    .from(honoServices)
    .then((rows) => new Set(rows.map((r) => r.port)));
  for (let p = 6500; p <= 6999; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("No available API port in 6500-6999");
}

function countRouteFiles(jobDir: string): number {
  const dir = path.join(jobDir, "src", "routes");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== ".gitkeep").length;
}

export async function destroyHonoService(honoServiceId: number): Promise<void> {
  const [row] = await db.select().from(honoServices).where(eq(honoServices.id, honoServiceId)).limit(1);
  if (!row) return;

  const apiSlug = `job-${row.jobId}-api`;
  const containerName = `scrapekit-${apiSlug}`;

  try { execSync(`docker rm -f ${containerName}`, { stdio: "pipe" }); } catch { /* ignore */ }
  try { execSync(`docker rmi ${row.imageTag}`, { stdio: "pipe" }); } catch { /* ignore */ }

  await db.update(honoServices).set({ status: "stopped" }).where(eq(honoServices.id, honoServiceId));
  await updateContainerStatus(apiSlug, "destroyed").catch(() => { /* ignore */ });
}
