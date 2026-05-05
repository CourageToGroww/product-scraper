import Docker from "dockerode";
import { execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import postgres from "postgres";
import { ensureNetwork } from "./network.js";

const docker = new Docker();

const REGISTRY_DIR = path.join(os.homedir(), ".scrapekit");
const REGISTRY_FILE = path.join(REGISTRY_DIR, "registry.json");
const CONFIG_FILE = path.join(REGISTRY_DIR, "config.json");
const DATA_DIR = path.join(REGISTRY_DIR, "data");
export const EXPORT_DIR = path.join(REGISTRY_DIR, "exports");
export const COMPOSE_FILE = path.join(REGISTRY_DIR, "docker-compose.yml");
const PROJECT_NAME = "scrapekit";
const BASE_PORT = 5433;
const DB_IMAGE = "postgres:17-alpine";
const CONTAINER_PREFIX = "scrapekit-db-";
const DB_USER = "scrapekit";
const DB_PASSWORD = "scrapekit";
const DB_NAME = "scrapekit";

export interface ProjectDb {
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

interface ScrapeKitConfig {
  mainDbPort: number;
}

// --- Config ---

export function loadConfig(): ScrapeKitConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch { /* corrupted */ }
  return { mainDbPort: 5432 };
}

export function saveConfig(config: ScrapeKitConfig): void {
  ensureDir(REGISTRY_DIR);
  const tmp = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
}

// --- Registry ---

export function loadRegistry(): ProjectDb[] {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
    }
  } catch { /* corrupted */ }
  return [];
}

export function saveRegistry(dbs: ProjectDb[]) {
  ensureDir(REGISTRY_DIR);
  const tmp = REGISTRY_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(dbs, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, REGISTRY_FILE);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// --- Port detection ---

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

export async function findAvailablePort(dbs: ProjectDb[]): Promise<number> {
  const config = loadConfig();
  const usedPorts = new Set([...dbs.map(d => d.port), config.mainDbPort]);
  let port = BASE_PORT;
  while (usedPorts.has(port) || !(await isPortAvailable(port))) {
    port++;
  }
  return port;
}

// --- Helpers ---

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 60);
}

export function connectionUrl(port: number): string {
  return `postgres://${DB_USER}:${DB_PASSWORD}@localhost:${port}/${DB_NAME}`;
}

export function getDocker(): Docker {
  return docker;
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function getContainerStatus(containerId: string): Promise<"running" | "stopped" | "error"> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return info.State.Running ? "running" : "stopped";
  } catch {
    return "error";
  }
}

// --- Single compose file generation ---

function serviceBlock(serviceName: string, containerName: string, port: number, volumeSource: string): string {
  return `
  ${serviceName}:
    image: ${DB_IMAGE}
    container_name: ${containerName}
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    ports:
      - "${port}:5432"
    volumes:
      - ${volumeSource}:/var/lib/postgresql/data
    networks:
      - scrapekit-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped`;
}

export function regenerateComposeFile(): void {
  const config = loadConfig();
  const dbs = loadRegistry();

  let yaml = `# ScrapeKit Workbench — Managed Database Registry
# All databases are managed via the ScrapeKit UI
# Manual: docker compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} ps|up|down
#
# Start all:  docker compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} up -d
# Stop all:   docker compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} down
# Status:     docker compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} ps

services:`;

  // Main database (named volume for persistence)
  yaml += serviceBlock("main-db", "scrapekit-main-db", config.mainDbPort, "main-pgdata");

  // Per-dataset databases (bind mounts for data isolation)
  for (const entry of dbs) {
    yaml += serviceBlock(entry.id, `${CONTAINER_PREFIX}${entry.id}`, entry.port, entry.dataPath);
  }

  yaml += `

volumes:
  main-pgdata:
    name: scrapekit-main-pgdata

networks:
  scrapekit-net:
    external: true
    name: scrapekit-net
`;

  ensureDir(REGISTRY_DIR);
  fs.writeFileSync(COMPOSE_FILE, yaml);
}

// --- Compose CLI helpers ---

function compose(...args: string[]): string {
  const cmd = `docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" ${args.join(" ")}`;
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

// --- Health check ---

async function waitForPostgres(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const sql = postgres(connectionUrl(port), { connect_timeout: 2, max: 1 });
      await sql`SELECT 1`;
      await sql.end();
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`PostgreSQL on port ${port} did not become ready within ${timeoutMs}ms`);
}

// --- Schema push (raw SQL, no drizzle-kit dependency) ---

async function pushResultsSchema(port: number): Promise<void> {
  const sql = postgres(connectionUrl(port), { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS scrape_results (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        status INTEGER,
        original_status INTEGER,
        timing INTEGER,
        response_type TEXT,
        extracted_data JSONB,
        autoparse_data JSONB,
        network_requests JSONB,
        converted_content TEXT,
        raw_html TEXT,
        screenshot_base64 TEXT,
        error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS scrape_results_job_idx ON scrape_results(job_id)`;
  } finally {
    await sql.end();
  }
}

// --- Per-job database ---

export interface SpawnResult {
  containerId: string;
  port: number;
  slug: string;
}

export async function spawnJobDatabase(jobId: number, jobName: string): Promise<SpawnResult> {
  const available = await isDockerAvailable();
  if (!available) {
    throw new Error("Docker is not running. Start Docker and retry.");
  }

  await ensureNetwork();

  const dbs = loadRegistry();
  const slug = slugify(`job-${jobId}-${jobName}`);
  const port = await findAvailablePort(dbs);
  const dataPath = path.join(DATA_DIR, slug);

  ensureDir(dataPath);

  // Add to registry first
  const entry: ProjectDb = {
    id: slug,
    name: `Job #${jobId}: ${jobName}`,
    port,
    containerId: "", // filled after compose up
    status: "running",
    createdAt: new Date().toISOString(),
    dataPath,
    jobId
  };
  dbs.push(entry);
  saveRegistry(dbs);

  // Regenerate compose file with new service, then start it
  regenerateComposeFile();
  compose("up", "-d", "--quiet-pull", slug);

  // Get the container ID
  const containerId = compose("ps", "-q", slug).trim();
  entry.containerId = containerId;
  saveRegistry(dbs);

  await waitForPostgres(port);
  await pushResultsSchema(port);

  return { containerId, port, slug };
}

// --- Manual database creation (for databases route) ---

export async function createDatabase(name: string): Promise<ProjectDb> {
  const available = await isDockerAvailable();
  if (!available) {
    throw new Error("Docker is not running. Cannot create database container.");
  }

  await ensureNetwork();

  const dbs = loadRegistry();
  const slug = slugify(name);
  const port = await findAvailablePort(dbs);
  const dataPath = path.join(DATA_DIR, slug);

  ensureDir(dataPath);

  const entry: ProjectDb = {
    id: slug,
    name,
    port,
    containerId: "",
    status: "running",
    createdAt: new Date().toISOString(),
    dataPath
  };
  dbs.push(entry);
  saveRegistry(dbs);

  regenerateComposeFile();
  compose("up", "-d", "--quiet-pull", slug);

  const containerId = compose("ps", "-q", slug).trim();
  entry.containerId = containerId;
  saveRegistry(dbs);

  return entry;
}

// --- Container lifecycle ---

export function startDatabase(entry: ProjectDb): void {
  regenerateComposeFile(); // ensure compose file is current
  compose("start", entry.id);
}

export function stopDatabase(entry: ProjectDb): void {
  compose("stop", entry.id);
}

export interface ExportResult {
  dir: string;
  dumpPath: string;
  dockerfilePath: string;
  composePath: string;
  size: number;
}

export async function exportJobDatabase(containerId: string, slug: string): Promise<ExportResult> {
  const exportDir = path.join(EXPORT_DIR, slug);
  ensureDir(exportDir);

  const dumpPath = path.join(exportDir, "init.sql");
  const dockerfilePath = path.join(exportDir, "Dockerfile");
  const composePath = path.join(exportDir, "docker-compose.yml");

  // Find the service name from registry
  const dbs = loadRegistry();
  const entry = dbs.find(d => d.containerId === containerId);
  const serviceName = entry?.id || slug;

  // pg_dump as plain SQL (usable as docker-entrypoint-initdb.d script)
  execSync(
    `docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" exec -T ${serviceName} pg_dump -U ${DB_USER} --clean --if-exists ${DB_NAME} > "${dumpPath}"`,
    { stdio: ["pipe", "pipe", "pipe"], shell: "/bin/bash" }
  );

  // Generate standalone Dockerfile
  fs.writeFileSync(dockerfilePath, `FROM ${DB_IMAGE}
ENV POSTGRES_USER=${DB_USER}
ENV POSTGRES_PASSWORD=${DB_PASSWORD}
ENV POSTGRES_DB=${DB_NAME}
COPY init.sql /docker-entrypoint-initdb.d/
EXPOSE 5432
`);

  // Generate standalone docker-compose.yml
  fs.writeFileSync(composePath, `# Exported from ScrapeKit Workbench — ${entry?.name || slug}
# Usage: docker compose up -d

services:
  postgres:
    build: .
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`);

  const stat = fs.statSync(dumpPath);
  return { dir: exportDir, dumpPath, dockerfilePath, composePath, size: stat.size };
}

export async function destroyJobDatabase(containerId: string): Promise<void> {
  const dbs = loadRegistry();
  const idx = dbs.findIndex(d => d.containerId === containerId);

  if (idx !== -1) {
    const entry = dbs[idx];

    // Stop and remove the service via compose
    try {
      compose("stop", entry.id);
      compose("rm", "-f", entry.id);
    } catch {
      // Service may already be gone
    }

    // Remove from registry and regenerate compose (service disappears from file)
    dbs.splice(idx, 1);
    saveRegistry(dbs);
    regenerateComposeFile();

    // Clean data directory (Docker creates files as root/postgres UID, so use
    // a throwaway container to remove them, falling back to fs.rmSync)
    if (fs.existsSync(entry.dataPath)) {
      try {
        execSync(
          `docker run --rm -v "${path.dirname(entry.dataPath)}:/mnt" alpine rm -rf "/mnt/${path.basename(entry.dataPath)}"`,
          { stdio: "pipe" }
        );
      } catch {
        fs.rmSync(entry.dataPath, { recursive: true, force: true });
      }
    }
  } else {
    // Not in registry — try direct container removal
    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      if (info.State.Running) {
        await container.stop();
      }
      await container.remove({ v: true });
    } catch {
      // Container may already be removed
    }
  }
}

// ============================================================
// Per-Dataset Database Functions
// ============================================================

/**
 * Push a typed schema to a dataset database.
 * Creates a `dataset_data` table with TEXT columns based on the schema keys.
 * Column names are sanitized to prevent SQL injection.
 */
export async function pushDatasetSchema(port: number, schemaColumns: string[]): Promise<void> {
  const sql = postgres(connectionUrl(port), { max: 1 });
  try {
    // Sanitize column names: allow only alphanumeric + underscore, max 63 chars
    const sanitized = schemaColumns
      .map(col => col.replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 63))
      .filter(col => col.length > 0 && col !== "id" && col !== "row_index");

    const columnDefs = sanitized.map(col => `"${col}" TEXT`).join(",\n        ");

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS dataset_data (
        id SERIAL PRIMARY KEY,
        row_index INTEGER NOT NULL,
        ${columnDefs}
      )
    `);
    await sql`CREATE INDEX IF NOT EXISTS dataset_data_row_idx ON dataset_data(row_index)`;
  } finally {
    await sql.end();
  }
}

/**
 * Bulk insert rows into a dataset database's `dataset_data` table.
 */
export async function pushDatasetRows(
  port: number,
  rows: Record<string, unknown>[],
  schemaColumns: string[]
): Promise<void> {
  if (rows.length === 0) return;

  const sql = postgres(connectionUrl(port), { max: 3 });
  try {
    const sanitized = schemaColumns
      .map(col => col.replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 63))
      .filter(col => col.length > 0 && col !== "id" && col !== "row_index");

    // Insert in batches of 500
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const cols = ["row_index", ...sanitized];
      const colNames = cols.map(c => `"${c}"`).join(", ");

      const values = batch.map((row, batchIdx) => {
        const rowIdx = i + batchIdx;
        const vals = [String(rowIdx), ...sanitized.map(col => {
          const v = row[col];
          return v == null ? null : String(v);
        })];
        return `(${vals.map(v => v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`).join(", ")})`;
      }).join(",\n");

      await sql.unsafe(`INSERT INTO dataset_data (${colNames}) VALUES ${values}`);
    }
  } finally {
    await sql.end();
  }
}

/**
 * Spawn a Docker database container for a dataset with typed columns.
 */
export async function spawnDatasetDatabase(
  datasetId: number,
  datasetName: string,
  schemaColumns: string[],
  rows: Record<string, unknown>[]
): Promise<SpawnResult> {
  const available = await isDockerAvailable();
  if (!available) {
    throw new Error("Docker is not running. Start Docker and retry.");
  }

  await ensureNetwork();

  const dbs = loadRegistry();
  const slug = slugify(`dataset-${datasetId}-${datasetName}`);
  const port = await findAvailablePort(dbs);
  const dataPath = path.join(DATA_DIR, slug);

  ensureDir(dataPath);

  const entry: ProjectDb = {
    id: slug,
    name: `Dataset #${datasetId}: ${datasetName}`,
    port,
    containerId: "",
    status: "running",
    createdAt: new Date().toISOString(),
    dataPath,
    datasetId
  };
  dbs.push(entry);
  saveRegistry(dbs);

  regenerateComposeFile();
  compose("up", "-d", "--quiet-pull", slug);

  const containerId = compose("ps", "-q", slug).trim();
  entry.containerId = containerId;
  saveRegistry(dbs);

  await waitForPostgres(port);
  await pushDatasetSchema(port, schemaColumns);
  await pushDatasetRows(port, rows, schemaColumns);

  return { containerId, port, slug };
}

/**
 * Destroy a dataset's Docker database container and clean up data.
 */
export async function destroyDatasetDatabase(containerId: string): Promise<void> {
  // Reuses the same logic as destroyJobDatabase
  return destroyJobDatabase(containerId);
}

/**
 * Export a dataset's Docker database as standalone Dockerfile + SQL dump.
 */
export async function exportDatasetDatabase(containerId: string, slug: string): Promise<ExportResult> {
  // Reuses the same logic as exportJobDatabase
  return exportJobDatabase(containerId, slug);
}
