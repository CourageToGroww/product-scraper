import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { db } from "../db.js";
import { datasets, scrapeJobs, honoServices, containers } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";

const JOBS_DIR = path.join(process.cwd(), "jobs");
const EXPORTS_DIR = path.join(process.cwd(), "exports");

export interface ExportBundle {
  dir: string;
  jobId: number;
  size: number;
}

export async function buildJobBundle(jobId: number): Promise<ExportBundle> {
  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const [ds] = await db.select().from(datasets)
    .where(eq(datasets.sourceJobId, jobId))
    .orderBy(desc(datasets.id)).limit(1);
  if (!ds || !ds.databasePort || !ds.databaseContainerId) {
    throw new Error("Dataset DB not available; run pipeline first");
  }

  const [creds] = await db.select({
    user: containers.dbUser,
    password: containers.password,
    dbName: containers.dbName,
    slug: containers.slug,
    containerId: containers.containerId
  }).from(containers).where(eq(containers.datasetId, ds.id)).orderBy(desc(containers.id)).limit(1);
  if (!creds) throw new Error("Container credentials not found");

  const [service] = await db.select().from(honoServices)
    .where(eq(honoServices.jobId, jobId))
    .orderBy(desc(honoServices.id)).limit(1);

  const slug = `job-${jobId}-${(job.name || "bundle").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
  const bundleDir = path.join(EXPORTS_DIR, slug);
  fs.mkdirSync(bundleDir, { recursive: true });

  // 1. pg_dump from the running dataset container
  const dumpPath = path.join(bundleDir, "init.sql");
  const containerRef = creds.containerId || `scrapekit-db-${creds.slug}`;
  execSync(
    `docker exec ${containerRef} pg_dump -U ${creds.user} --clean --if-exists ${creds.dbName} > "${dumpPath}"`,
    { stdio: ["pipe", "pipe", "inherit"], shell: "/bin/bash" }
  );
  execSync(`gzip -f "${dumpPath}"`);

  // 2. Copy api/ from workbench/jobs/<jobId>/api
  const apiSrc = path.join(JOBS_DIR, String(jobId), "api");
  const apiDst = path.join(bundleDir, "api");
  if (fs.existsSync(apiSrc)) {
    copyRecursiveSync(apiSrc, apiDst);
  }

  // 3. docker-compose.yml
  const composeContent = `# ScrapeKit bundle for job #${jobId}: ${job.name || "(unnamed)"}
# Quick start: docker compose up --build

services:
  db:
    image: postgres:17-alpine
    container_name: ${slug}-db
    environment:
      POSTGRES_USER: ${creds.user}
      POSTGRES_PASSWORD: ${creds.password}
      POSTGRES_DB: ${creds.dbName}
    ports:
      - "5432:5432"
    volumes:
      - dbdata:/var/lib/postgresql/data
      - ./init.sql.gz:/docker-entrypoint-initdb.d/init.sql.gz:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${creds.user}"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
${service ? `
  api:
    build: ./api
    container_name: ${slug}-api
    environment:
      DATABASE_URL: postgres://${creds.user}:${creds.password}@db:5432/${creds.dbName}
      PORT: "3001"
    ports:
      - "3001:3001"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
` : ""}
volumes:
  dbdata:
`;
  fs.writeFileSync(path.join(bundleDir, "docker-compose.yml"), composeContent);

  fs.writeFileSync(path.join(bundleDir, ".env.example"), `POSTGRES_USER=${creds.user}
POSTGRES_PASSWORD=${creds.password}
POSTGRES_DB=${creds.dbName}
DATABASE_URL=postgres://${creds.user}:${creds.password}@db:5432/${creds.dbName}
`);

  const readme = `# ScrapeKit Bundle: ${job.name || `Job ${jobId}`}

Self-contained export from ScrapeKit.

## Quick start
\`\`\`
docker compose up --build
\`\`\`

- Postgres: postgres://${creds.user}:${creds.password}@localhost:5432/${creds.dbName}
${service ? `- API: http://localhost:3001/health` : ""}

## Editing the API

Edit handler files under \`api/src/routes/\` then:
\`\`\`
docker compose up --build api
\`\`\`

## Connecting from another app

Set \`DATABASE_URL\` to:
postgres://${creds.user}:${creds.password}@localhost:5432/${creds.dbName}

The dump is loaded automatically on first start (when the volume is empty).
`;
  fs.writeFileSync(path.join(bundleDir, "README.md"), readme);

  const size = totalSize(bundleDir);
  return { dir: bundleDir, jobId, size };
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

function totalSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += totalSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}
