# ScrapeKit Export + Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two features that complete the ScrapeKit user story.
1. **Export bundle** — produce a self-contained, portable directory (and optional `.tar.gz`) for any job that contains: a Postgres `init.sql.gz` dump of the dataset DB, the AI-generated Hono service source (`api/`), a `docker-compose.yml` wiring both, an `.env.example`, and a `README.md`. The user can `tar xzf bundle.tar.gz && cd bundle && docker compose up` and have a fully working stack on any machine with Docker.
2. **Merge** — combine N existing dataset DBs into a new merge-target Postgres container. Sources stay intact. Target is registered in `containers` (type `merge-target`) and persisted in a new `merges` table so the merge can be re-run later. Implementation: spin target Postgres on `scrapekit-net`, set up `postgres_fdw` foreign-server entries to each source, run `INSERT INTO target.t SELECT * FROM source_<n>.t` per shared table, drop the foreign-server entries.

**Architecture:** A new `workbench/src/server/lib/export-bundle/` directory holds a `bundle-builder.ts` module that orchestrates pg_dump + file assembly + tar packaging. A new `workbench/src/server/lib/merge/` directory holds `merge-runner.ts` (the postgres_fdw orchestrator) and `merge-store.ts` (DB helper for the new `merges` table). Two new REST sections: `/api/ai/jobs/:id/export-bundle` (POST + GET-download) and `/api/merges` (full CRUD). UI gets one new export button on `JobApiPage` and two new pages: `MergeListPage` and `MergeBuilderPage` (pick sources + target name, kick off merge, view runs).

**Tech Stack:** Node.js 22, TypeScript, dockerode, postgres-js, Hono, Zod, tar (Node built-in via `child_process` shelling to `tar`), Drizzle ORM, drizzle-kit, React 18.

---

## File Structure

**New server files:**
- `workbench/src/server/lib/export-bundle/bundle-builder.ts` — assembles bundle dir from a job
- `workbench/src/server/lib/export-bundle/tar.ts` — tar.gz helper (`packDir(dir) -> tarPath`)
- `workbench/src/server/lib/merge/merge-store.ts` — `merges` table CRUD
- `workbench/src/server/lib/merge/merge-runner.ts` — postgres_fdw orchestrator + new container spawn
- `workbench/src/server/routes/exports.ts` — export endpoints
- `workbench/src/server/routes/merges.ts` — merge endpoints

**New client files:**
- `workbench/src/client/pages/MergeListPage.tsx`
- `workbench/src/client/pages/MergeBuilderPage.tsx`
- `workbench/src/client/components/ExportBundleButton.tsx`

**Modified files:**
- `workbench/src/db/schema.ts` — add `merges` table
- `workbench/src/server/app.ts` — mount the two new routes
- `workbench/src/server/lib/docker-manager.ts` — add `spawnMergeTargetDatabase` helper (parallels `spawnDatasetDatabase`)
- `workbench/src/client/lib/api.ts` — add `exports` and `merges` resources
- `workbench/src/client/lib/hooks.ts` — add merge + export hooks
- `workbench/src/client/App.tsx` — register `/merges` and `/merges/new` routes
- `workbench/src/client/pages/JobApiPage.tsx` — render `<ExportBundleButton jobId={...} />`
- `workbench/src/client/components/Layout.tsx` — add "Merges" nav link (if a nav exists)

---

## Task 1: Add `merges` table to schema

**Files:**
- Modify: `workbench/src/db/schema.ts`
- Auto-generated: `workbench/src/db/migrations/<n>_*.sql`

- [ ] **Step 1: Append `merges` table to `schema.ts`**

```typescript
export const merges = pgTable("merges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Source dataset IDs as JSON array of numbers. */
  sourceDatasetIds: jsonb("source_dataset_ids").notNull().$type<number[]>(),
  /** Target container row id (created when merge first runs). */
  targetContainerId: integer("target_container_id").references(() => containers.id, { onDelete: "set null" }),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).notNull().default("pending"),
  rowCounts: jsonb("row_counts").$type<Record<string, number>>(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => [
  index("merges_status_idx").on(table.status)
]);
```

- [ ] **Step 2: Generate + apply migration**

```bash
cd /home/jake/Programming/tools/product-scraper/workbench
npm run db:generate
DATABASE_URL=postgres://scrapekit:scrapekit@localhost:5434/scrapekit npm run db:push -- --force
```

Verify the new table:
```bash
PGPASSWORD=scrapekit psql -h localhost -p 5434 -U scrapekit -d scrapekit -c "\d merges"
```

- [ ] **Step 3: Commit**

```bash
git add workbench/src/db/schema.ts workbench/src/db/migrations/
git commit -m "feat(db): add merges table for multi-dataset merge tracking"
```

---

## Task 2: Bundle builder module

**Files:**
- Create: `workbench/src/server/lib/export-bundle/bundle-builder.ts`

- [ ] **Step 1: Implement**

```typescript
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

/**
 * Build a self-contained export bundle for a job.
 * Layout:
 *   <bundleDir>/
 *     docker-compose.yml
 *     init.sql.gz
 *     api/                       (copied from workbench/jobs/<jobId>/api)
 *     .env.example
 *     README.md
 */
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
    slug: containers.slug
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
  execSync(
    `docker exec ${creds.slug.startsWith("scrapekit-") ? creds.slug : `scrapekit-db-${creds.slug}`} pg_dump -U ${creds.user} --clean --if-exists ${creds.dbName} > "${dumpPath}"`,
    { stdio: ["pipe", "pipe", "inherit"], shell: "/bin/bash" }
  );
  // gzip it
  execSync(`gzip -f "${dumpPath}"`);
  const gzPath = `${dumpPath}.gz`;

  // 2. Copy api/ from workbench/jobs/<jobId>/api
  const apiSrc = path.join(JOBS_DIR, String(jobId), "api");
  const apiDst = path.join(bundleDir, "api");
  if (fs.existsSync(apiSrc)) {
    copyRecursiveSync(apiSrc, apiDst);
  }

  // 3. Generate docker-compose.yml
  const composeContent = `# ScrapeKit bundle for job #${jobId}: ${job.name || "(unnamed)"}
# Quick start:
#   docker compose up --build
# Then:
#   curl http://localhost:5432    (db)
#   curl http://localhost:3001/health  (api)

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

  // 4. .env.example
  fs.writeFileSync(path.join(bundleDir, ".env.example"), `# Override defaults if needed
POSTGRES_USER=${creds.user}
POSTGRES_PASSWORD=${creds.password}
POSTGRES_DB=${creds.dbName}
DATABASE_URL=postgres://${creds.user}:${creds.password}@db:5432/${creds.dbName}
`);

  // 5. README
  const readme = `# ScrapeKit Bundle: ${job.name || `Job ${jobId}`}

Self-contained export from ScrapeKit. Includes:
- ${'`init.sql.gz`'} — full Postgres dump of the dataset DB
- ${'`docker-compose.yml`'} — brings up Postgres + Hono API
- ${'`api/`'} — Hono service source (Drizzle ORM, AI-generated CRUD routes)
- ${'`.env.example`'} — connection details

## Quick start

\`\`\`
docker compose up --build
\`\`\`

Then:
- Postgres: \`postgres://${creds.user}:${creds.password}@localhost:5432/${creds.dbName}\`
${service ? `- API health: http://localhost:3001/health\n- API root: http://localhost:3001/` : ""}

## Editing the API

The Hono source is in ${'`api/src/`'}. To customize:

1. Edit handler files under ${'`api/src/routes/`'}.
2. Rebuild and restart:
   \`\`\`
   docker compose up --build api
   \`\`\`

## Connecting from another app

Set ${'`DATABASE_URL`'} to:
${'`postgres://' + creds.user + ':' + creds.password + '@localhost:5432/' + creds.dbName + '`'}

The dump is loaded automatically on first start (when the volume is empty).
On subsequent runs the existing volume data is preserved.
`;
  fs.writeFileSync(path.join(bundleDir, "README.md"), readme);

  // Compute total size
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
```

- [ ] **Step 2: Type check + commit**

```bash
cd /home/jake/Programming/tools/product-scraper/workbench
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/lib/export-bundle/bundle-builder.ts
git commit -m "feat(export-bundle): assemble self-contained job bundle (compose + dump + api + README)"
```

---

## Task 3: tar packer

**Files:** `workbench/src/server/lib/export-bundle/tar.ts`

- [ ] **Step 1: Implement**

```typescript
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export function packDir(dir: string): { tarPath: string; size: number } {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  const tarPath = `${dir}.tar.gz`;
  // tar -C parent -czf out.tar.gz base
  execSync(`tar -C "${parent}" -czf "${tarPath}" "${base}"`);
  const size = fs.statSync(tarPath).size;
  return { tarPath, size };
}
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/server/lib/export-bundle/tar.ts
git commit -m "feat(export-bundle): tar.gz packer (shells to system tar)"
```

---

## Task 4: Export REST endpoints

**Files:** `workbench/src/server/routes/exports.ts` (new), `workbench/src/server/app.ts` (mount)

- [ ] **Step 1: Implement routes**

```typescript
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { buildJobBundle } from "../lib/export-bundle/bundle-builder.js";
import { packDir } from "../lib/export-bundle/tar.js";

const app = new Hono();

app.post("/jobs/:id/export-bundle", async (c) => {
  const jobId = Number(c.req.param("id"));
  if (!Number.isInteger(jobId) || jobId <= 0) return c.json({ error: "Invalid job id" }, 400);
  try {
    const bundle = await buildJobBundle(jobId);
    return c.json(bundle);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/jobs/:id/export-bundle/download", async (c) => {
  const jobId = Number(c.req.param("id"));
  if (!Number.isInteger(jobId) || jobId <= 0) return c.json({ error: "Invalid job id" }, 400);
  try {
    const bundle = await buildJobBundle(jobId);
    const { tarPath } = packDir(bundle.dir);
    const stream = fs.createReadStream(tarPath);
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${path.basename(tarPath)}"`
      }
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default app;
```

- [ ] **Step 2: Mount in `app.ts`**

```typescript
import exportRoutes from "./routes/exports.js";
// ...
app.route("/api/ai", exportRoutes);
```

(Mounted under `/api/ai` so the paths are `/api/ai/jobs/:id/export-bundle` etc., consistent with the rest of the AI section.)

- [ ] **Step 3: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/routes/exports.ts workbench/src/server/app.ts
git commit -m "feat(exports): REST endpoints to build + download job bundles"
```

---

## Task 5: `merge-store.ts`

**Files:** `workbench/src/server/lib/merge/merge-store.ts`

- [ ] **Step 1: Implement**

```typescript
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
  const [row] = await db.update(merges).set({
    status: "running",
    startedAt: new Date()
  }).where(eq(merges.id, id)).returning();
  return row;
}

export async function completeMergeRun(id: number, args: { rowCounts: Record<string, number>; targetContainerId: number }) {
  const [row] = await db.update(merges).set({
    status: "completed",
    rowCounts: args.rowCounts,
    targetContainerId: args.targetContainerId,
    completedAt: new Date()
  }).where(eq(merges.id, id)).returning();
  return row;
}

export async function failMergeRun(id: number, errorMessage: string) {
  const [row] = await db.update(merges).set({
    status: "failed",
    errorMessage,
    completedAt: new Date()
  }).where(eq(merges.id, id)).returning();
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
```

- [ ] **Step 2: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/lib/merge/merge-store.ts
git commit -m "feat(merge): merges table CRUD helpers"
```

---

## Task 6: `merge-runner.ts` — postgres_fdw orchestrator

**Files:** `workbench/src/server/lib/merge/merge-runner.ts`

- [ ] **Step 1: Implement**

```typescript
import path from "node:path";
import postgres from "postgres";
import { db } from "../db.js";
import { datasets, containers as containersTable } from "../../../db/schema.js";
import { eq, desc, inArray } from "drizzle-orm";
import { ensureNetwork } from "../network.js";
import { spawnDatasetDatabase } from "../docker-manager.js";
import { startMergeRun, completeMergeRun, failMergeRun, getMerge } from "./merge-store.js";

interface SourceCreds {
  datasetId: number;
  hostInNetwork: string;  // container hostname on scrapekit-net
  port: number;            // internal 5432
  user: string;
  password: string;
  dbName: string;
}

async function loadSourceCreds(datasetIds: number[]): Promise<SourceCreds[]> {
  const dsRows = await db.select().from(datasets).where(inArray(datasets.id, datasetIds));
  const containerRows = await db.select().from(containersTable)
    .where(inArray(containersTable.datasetId, datasetIds));

  const result: SourceCreds[] = [];
  for (const ds of dsRows) {
    const container = containerRows
      .filter(c => c.datasetId === ds.id)
      .sort((a, b) => b.id - a.id)[0];
    if (!container) throw new Error(`No container row for dataset ${ds.id}`);
    if (!ds.databasePort) throw new Error(`Dataset ${ds.id} has no running DB`);
    // hostname on scrapekit-net = the container's name (e.g. scrapekit-db-<slug>)
    // The container_name is `scrapekit-db-${slug}` from CONTAINER_PREFIX.
    const hostInNetwork = `scrapekit-db-${container.slug}`;
    result.push({
      datasetId: ds.id,
      hostInNetwork,
      port: 5432,
      user: container.dbUser,
      password: container.password,
      dbName: container.dbName
    });
  }
  return result;
}

export async function runMerge(mergeId: number): Promise<{ targetContainerId: number; rowCounts: Record<string, number> }> {
  await ensureNetwork();
  const merge = await getMerge(mergeId);
  if (!merge) throw new Error(`Merge ${mergeId} not found`);

  await startMergeRun(mergeId);

  try {
    const sources = await loadSourceCreds(merge.sourceDatasetIds);
    if (sources.length === 0) throw new Error("No source datasets");

    // 1. Spawn target Postgres container as a "merge-target"
    // We piggy-back on spawnDatasetDatabase's behavior: it creates a per-dataset DB. We fake datasetId=-mergeId
    // by using a separate helper would be cleaner; here we use the existing helper with a synthetic name and
    // immediately update the row's type.
    const target = await spawnDatasetDatabase(
      mergeId,                     // pass mergeId — the row will be tagged with this datasetId
      `merge-${mergeId}`,
      [],                          // no schema columns yet — schema is materialized below
      []                           // no rows yet
    );

    // Update the freshly-spawned containers row's type to 'merge-target'.
    const [targetContainer] = await db.select().from(containersTable)
      .where(eq(containersTable.containerId, target.containerId)).limit(1);
    if (!targetContainer) throw new Error("Target container row not found after spawn");
    await db.update(containersTable)
      .set({ type: "merge-target", datasetId: null })
      .where(eq(containersTable.id, targetContainer.id));

    // 2. Connect to the target DB as superuser-equivalent, install postgres_fdw, mount each source
    const targetUrl = `postgres://${targetContainer.dbUser}:${encodeURIComponent(targetContainer.password)}@localhost:${target.port}/${targetContainer.dbName}`;
    const sql = postgres(targetUrl, { max: 1 });

    const rowCounts: Record<string, number> = {};

    try {
      await sql`CREATE EXTENSION IF NOT EXISTS postgres_fdw`;

      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        const serverName = `src_${i}`;
        const userMap = `src_${i}_user`;
        const remoteSchema = `src_${i}`;

        // Drop old definitions if they exist (idempotent re-run safety)
        await sql.unsafe(`DROP SCHEMA IF EXISTS ${remoteSchema} CASCADE`);
        await sql.unsafe(`DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER ${serverName}`);
        await sql.unsafe(`DROP SERVER IF EXISTS ${serverName} CASCADE`);

        await sql.unsafe(
          `CREATE SERVER ${serverName} FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host '${s.hostInNetwork}', port '${s.port}', dbname '${s.dbName}')`
        );
        await sql.unsafe(
          `CREATE USER MAPPING FOR CURRENT_USER SERVER ${serverName} OPTIONS (user '${s.user}', password '${s.password}')`
        );
        await sql.unsafe(`CREATE SCHEMA ${remoteSchema}`);
        await sql.unsafe(`IMPORT FOREIGN SCHEMA public FROM SERVER ${serverName} INTO ${remoteSchema}`);
      }

      // 3. Find tables that exist in ALL source schemas; for each, create a target table and copy.
      const srcSchemas = sources.map((_, i) => `src_${i}`);
      const tableRows = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ANY(${srcSchemas as unknown as string[]})
        GROUP BY table_name
        HAVING COUNT(DISTINCT table_schema) = ${sources.length}
      `;
      const sharedTables = tableRows.map(r => r.table_name);

      for (const t of sharedTables) {
        // Create target table by cloning structure from src_0
        await sql.unsafe(`CREATE TABLE IF NOT EXISTS public."${t}" (LIKE src_0."${t}" INCLUDING DEFAULTS)`);
        // For each source, append rows
        let count = 0;
        for (let i = 0; i < sources.length; i++) {
          const result = await sql.unsafe(`INSERT INTO public."${t}" SELECT * FROM src_${i}."${t}"`);
          count += (result as unknown as { count: number }).count ?? 0;
        }
        rowCounts[t] = count;
      }

      // 4. Tear down foreign-server entries
      for (let i = 0; i < sources.length; i++) {
        await sql.unsafe(`DROP SCHEMA IF EXISTS src_${i} CASCADE`);
        await sql.unsafe(`DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER src_${i}`);
        await sql.unsafe(`DROP SERVER IF EXISTS src_${i} CASCADE`);
      }
    } finally {
      await sql.end();
    }

    await completeMergeRun(mergeId, { rowCounts, targetContainerId: targetContainer.id });
    return { targetContainerId: targetContainer.id, rowCounts };
  } catch (err) {
    await failMergeRun(mergeId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
```

- [ ] **Step 2: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/lib/merge/merge-runner.ts
git commit -m "feat(merge): postgres_fdw-based merge runner (spawns target + copies shared tables)"
```

---

## Task 7: Merge REST endpoints

**Files:** `workbench/src/server/routes/merges.ts` (new), `workbench/src/server/app.ts` (mount)

- [ ] **Step 1: Implement**

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { createMerge, getMerge, listMerges, deleteMerge } from "../lib/merge/merge-store.js";
import { runMerge } from "../lib/merge/merge-runner.js";

const app = new Hono();

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sourceDatasetIds: z.array(z.number().int().positive()).min(2)
});

app.get("/", async (c) => c.json(await listMerges()));

app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getMerge(id);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  const merge = await createMerge(parsed.data);

  // Fire-and-forget: kick off the merge. Errors land in the merges row.
  runMerge(merge.id).catch((err) => console.error(`[merge ${merge.id}] failed:`, err));

  return c.json(merge);
});

app.post("/:id/rerun", async (c) => {
  const id = Number(c.req.param("id"));
  const merge = await getMerge(id);
  if (!merge) return c.json({ error: "Not found" }, 404);
  runMerge(id).catch((err) => console.error(`[merge ${id}] failed:`, err));
  return c.json({ ok: true });
});

app.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await deleteMerge(id);
  return c.json({ ok: true });
});

export default app;
```

- [ ] **Step 2: Mount in `app.ts`**

```typescript
import mergeRoutes from "./routes/merges.js";
// ...
app.route("/api/merges", mergeRoutes);
```

- [ ] **Step 3: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/routes/merges.ts workbench/src/server/app.ts
git commit -m "feat(merges): REST endpoints (CRUD + rerun)"
```

---

## Task 8: Client API + hooks for export + merges

**Files:** `workbench/src/client/lib/api.ts`, `workbench/src/client/lib/hooks.ts`

- [ ] **Step 1: Append `exports` and `merges` resources to `api.ts`**

```typescript
export const exports_ = {
  build: (jobId: number) => request<{ dir: string; jobId: number; size: number }>(`/ai/jobs/${jobId}/export-bundle`, { method: "POST", body: JSON.stringify({}) }),
  downloadUrl: (jobId: number) => `/api/ai/jobs/${jobId}/export-bundle/download`
};

export const merges = {
  list: () => request<any[]>("/merges"),
  get: (id: number) => request<any>(`/merges/${id}`),
  create: (data: { name: string; description?: string; sourceDatasetIds: number[] }) =>
    request<any>("/merges", { method: "POST", body: JSON.stringify(data) }),
  rerun: (id: number) => request<{ ok: boolean }>(`/merges/${id}/rerun`, { method: "POST", body: JSON.stringify({}) }),
  delete: (id: number) => request<{ ok: boolean }>(`/merges/${id}`, { method: "DELETE" })
};
```

(`exports_` is named with a trailing underscore because `exports` is reserved in CommonJS contexts; though in pure ESM it would be fine, the suffix avoids surprises.)

- [ ] **Step 2: Append hooks**

In `hooks.ts`:

```typescript
export function useBuildExportBundle() {
  return useMutation({ mutationFn: (jobId: number) => api.exports_.build(jobId) });
}

export function useMerges() {
  return useQuery({ queryKey: ["merges"], queryFn: () => api.merges.list() });
}

export function useMerge(id: number) {
  return useQuery({ queryKey: ["merge", id], queryFn: () => api.merges.get(id), enabled: id > 0 });
}

export function useCreateMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; sourceDatasetIds: number[] }) =>
      api.merges.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["merges"] }); }
  });
}

export function useRerunMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.merges.rerun(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["merges"] }); }
  });
}

export function useDeleteMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.merges.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["merges"] }); }
  });
}
```

- [ ] **Step 3: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/client/lib/api.ts workbench/src/client/lib/hooks.ts
git commit -m "feat(client): exports + merges API resources and hooks"
```

---

## Task 9: ExportBundleButton component + JobApiPage hookup

**Files:** `workbench/src/client/components/ExportBundleButton.tsx` (new), `workbench/src/client/pages/JobApiPage.tsx` (modify)

- [ ] **Step 1: Component**

```tsx
import React from "react";
import { useBuildExportBundle } from "../lib/hooks";
import { useToast } from "./Toast";

export default function ExportBundleButton({ jobId }: { jobId: number }) {
  const build = useBuildExportBundle();
  const { toast } = useToast();

  async function handleBuild() {
    try {
      const result = await build.mutateAsync(jobId);
      toast(`Bundle built (${(result.size / 1024).toFixed(1)} KB) at ${result.dir}`, "success");
    } catch (err: any) {
      toast(`Bundle build failed: ${err.message ?? String(err)}`, "error");
    }
  }

  return (
    <div style={{ display: "inline-flex", gap: "0.5rem" }}>
      <button onClick={handleBuild} disabled={build.isPending} style={{ padding: "0.4rem 0.75rem" }}>
        {build.isPending ? "Building..." : "Build export bundle"}
      </button>
      <a
        href={`/api/ai/jobs/${jobId}/export-bundle/download`}
        download
        style={{ padding: "0.4rem 0.75rem", border: "1px solid #ddd", borderRadius: "0.25rem", textDecoration: "none" }}
      >
        Download .tar.gz
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Add to `JobApiPage.tsx`**

Find the existing button row (the one with "Run pipeline", "Rebuild API service", "Open in Drizzle Studio") and add:

```tsx
import ExportBundleButton from "../components/ExportBundleButton";
// ...
<ExportBundleButton jobId={jobId} />
```

- [ ] **Step 3: Commit**

```bash
git add workbench/src/client/components/ExportBundleButton.tsx workbench/src/client/pages/JobApiPage.tsx
git commit -m "feat(client): ExportBundleButton on JobApiPage"
```

---

## Task 10: MergeListPage

**Files:** `workbench/src/client/pages/MergeListPage.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from "react";
import { Link } from "react-router-dom";
import { useMerges, useDeleteMerge, useRerunMerge } from "../lib/hooks";
import { useToast } from "../components/Toast";

export default function MergeListPage() {
  const { data: rows, isLoading, refetch } = useMerges();
  const del = useDeleteMerge();
  const rerun = useRerunMerge();
  const { toast } = useToast();

  if (isLoading) return <p>Loading...</p>;

  return (
    <div style={{ padding: "1rem", display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Merges</h2>
        <Link to="/merges/new" style={{ padding: "0.4rem 0.75rem", border: "1px solid #ddd", borderRadius: "0.25rem", textDecoration: "none" }}>+ New merge</Link>
      </div>
      {rows && rows.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cell}>ID</th>
              <th style={cell}>Name</th>
              <th style={cell}>Status</th>
              <th style={cell}>Sources</th>
              <th style={cell}>Created</th>
              <th style={cell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td style={cell}>{r.id}</td>
                <td style={cell}>{r.name}</td>
                <td style={cell}>{r.status}{r.errorMessage ? ` — ${r.errorMessage}` : ""}</td>
                <td style={cell}>{(r.sourceDatasetIds as number[]).join(", ")}</td>
                <td style={cell}>{new Date(r.createdAt).toLocaleString()}</td>
                <td style={cell}>
                  <button onClick={async () => { await rerun.mutateAsync(r.id); toast("Re-run started", "info"); refetch(); }} style={{ marginRight: "0.5rem" }}>Re-run</button>
                  <button onClick={async () => { await del.mutateAsync(r.id); toast("Deleted", "info"); refetch(); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p style={{ opacity: 0.7 }}>No merges yet.</p>}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "0.25rem 0.5rem", textAlign: "left", borderBottom: "1px solid #eee", fontSize: "0.85rem" };
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/pages/MergeListPage.tsx
git commit -m "feat(client): MergeListPage (list + rerun + delete)"
```

---

## Task 11: MergeBuilderPage

**Files:** `workbench/src/client/pages/MergeBuilderPage.tsx`

- [ ] **Step 1: Implement**

```tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDatasets, useCreateMerge } from "../lib/hooks";
import { useToast } from "../components/Toast";

export default function MergeBuilderPage() {
  const { data: datasetsResp, isLoading } = useDatasets();
  const create = useCreateMerge();
  const nav = useNavigate();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  if (isLoading) return <p>Loading...</p>;

  const datasets = (datasetsResp as any)?.datasets ?? [];

  function toggle(id: number) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) return toast("Name is required", "error");
    if (picked.size < 2) return toast("Pick at least 2 datasets", "error");
    try {
      const result = await create.mutateAsync({
        name, description: description.trim() || undefined,
        sourceDatasetIds: Array.from(picked)
      });
      toast(`Merge ${result.id} started`, "success");
      nav("/merges");
    } catch (err: any) {
      toast(`Merge failed: ${err.message ?? String(err)}`, "error");
    }
  }

  return (
    <div style={{ padding: "1rem", display: "grid", gap: "1rem", maxWidth: "640px" }}>
      <h2 style={{ margin: 0 }}>New merge</h2>
      <label>
        Name<br />
        <input value={name} onChange={e => setName(e.target.value)} style={{ width: "100%", padding: "0.4rem" }} />
      </label>
      <label>
        Description (optional)<br />
        <input value={description} onChange={e => setDescription(e.target.value)} style={{ width: "100%", padding: "0.4rem" }} />
      </label>
      <div>
        <strong>Pick source datasets (need at least 2 with running DBs):</strong>
        <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0" }}>
          {datasets.map((d: any) => (
            <li key={d.id} style={{ padding: "0.25rem 0" }}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: d.databaseStatus === "running" ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  disabled={d.databaseStatus !== "running"}
                  checked={picked.has(d.id)}
                  onChange={() => toggle(d.id)}
                />
                #{d.id} — {d.name} ({d.databaseStatus})
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <button onClick={submit} disabled={create.isPending} style={{ padding: "0.4rem 0.75rem" }}>
          {create.isPending ? "Starting..." : "Start merge"}
        </button>
      </div>
    </div>
  );
}
```

If `useDatasets` does NOT exist in `hooks.ts`, add it (it should already be there for the dataset list page; if not, follow the pattern of `usePipelineRuns`). Inspect with Serena first.

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/pages/MergeBuilderPage.tsx
git commit -m "feat(client): MergeBuilderPage (pick datasets + create merge)"
```

---

## Task 12: Wire merge routes in App.tsx + nav link

**Files:** `workbench/src/client/App.tsx`, `workbench/src/client/components/Layout.tsx`

- [ ] **Step 1: Register routes**

```typescript
import MergeListPage from "./pages/MergeListPage";
import MergeBuilderPage from "./pages/MergeBuilderPage";
// ...
<Route path="/merges" element={<MergeListPage />} />
<Route path="/merges/new" element={<MergeBuilderPage />} />
```

- [ ] **Step 2: Add nav link**

Read `workbench/src/client/components/Layout.tsx` with Serena. If it has a navigation list with Links to `/scrapes`, `/datasets`, etc., add:

```tsx
<Link to="/merges">Merges</Link>
```

If the layout has no nav, skip this step.

- [ ] **Step 3: Commit**

```bash
git add workbench/src/client/App.tsx workbench/src/client/components/Layout.tsx
git commit -m "feat(client): register /merges routes + nav link"
```

---

## Task 13: Smoke test

**Files:** none (verification)

- [ ] **Step 1: Verify TS + tests + Vite build**

```bash
cd /home/jake/Programming/tools/product-scraper/workbench
npx tsc -p tsconfig.server.json --noEmit
DATABASE_URL=postgres://scrapekit:scrapekit@localhost:5434/scrapekit npm test
npx vite build
```

All clean.

- [ ] **Step 2: Server smoke**

```bash
DATABASE_URL=postgres://scrapekit:scrapekit@localhost:5434/scrapekit PORT=3030 npx tsx src/server/index.ts &
SERVER_PID=$!
sleep 5

# Export endpoints
echo "--- export-bundle for non-existent job ---"
curl -s -X POST http://localhost:3030/api/ai/jobs/99999/export-bundle -H "Content-Type: application/json" -d '{}'

echo "--- merges list (empty) ---"
curl -s http://localhost:3030/api/merges

echo "--- merges create (validation: needs 2+ sources) ---"
curl -s -X POST http://localhost:3030/api/merges -H "Content-Type: application/json" -d '{"name":"t","sourceDatasetIds":[1]}'

echo "--- merges get not found ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/api/merges/99999

kill $SERVER_PID 2>/dev/null || true
```

Expected:
- export-bundle for missing job: 500 with `Job 99999 not found`
- merges list: `[]`
- merges create with 1 source: 400 with Zod validation error
- merges get unknown: 404

- [ ] **Step 3: No commit. Verification only.**

---

## Self-Review

**Spec coverage:**
- Self-contained export bundle (compose + dump + Hono src + README + .env.example) → Tasks 2, 4, 9
- Tarball download → Tasks 3, 4, 9
- Merge produces NEW container, sources preserved → Task 6
- Merge tracked in DB, re-runnable → Tasks 1, 5, 7
- UI for merges → Tasks 10, 11, 12
- Export button on per-job page → Task 9

**Type consistency:** `merges.sourceDatasetIds` is `number[]` jsonb; client + server agree. The merge runner reuses `spawnDatasetDatabase` for the target — slight reuse hack, but it gives us all the password/network plumbing for free.

**Placeholders:** none.

**Deferred / known limitations:**
- Merge: only handles tables that exist in ALL source schemas. Tables that only exist in some sources are skipped silently. A future iteration could `UNION ALL` heterogeneous schemas via column-by-column matching.
- Merge: assumes table names match across sources. Renaming or schema drift not handled.
- Tarball: shells to system `tar`. On Windows this would need an alternative (`node-tar` package).
- Bundle dir lives under `workbench/exports/`. Not gitignored; users should not commit.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-scrapekit-export-merge.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
**2. Inline Execution** — batch execution with checkpoints

Which approach?
