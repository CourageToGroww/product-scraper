# ScrapeKit Studio + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the AI Pipeline (Plan 2) in the UI. Per-job pages let the user (1) view pipeline run history, (2) inspect AI-generated schemas + Hono routes, (3) launch Drizzle Studio against the dataset DB, (4) chat with the AI to edit the schema or add custom routes, (5) rebuild the Hono container after edits, and (6) re-run any phase. No new database concepts; this plan is pure surface area.

**Architecture:** Two new server endpoints (`edit-schema`, `edit-routes`, `rebuild`, `studio/launch`) and one new page route (`/scrapes/:id/api`). The page composes four components (`PipelineStatusPanel`, `SchemaViewer`, `RouteEditor`, `AiChatPanel`). A `studio-launcher.ts` server module spawns `drizzle-kit studio` as a child process pointed at the dataset DB on a port from a pool 7500-7999, returning the launch URL. Studio processes are tracked in memory only — re-launching for the same job kills the previous one. The chat panel posts a free-form prompt + the current schema or route source; the server calls the LLM, gets back a structured edit (new SchemaSpec or appended RouteSpec), persists it to disk, and returns the updated artifact for the UI to display. The Rebuild button re-renders files and rebuilds + respawns the Hono container.

**Tech Stack:** React 18, react-router-dom v7, @tanstack/react-query (already in use), Tailwind CSS, Vite. Server side: Hono, Zod (existing). LLM via existing `llm-client.ts`.

---

## File Structure

**New server files:**
- `workbench/src/server/lib/ai-pipeline/studio-launcher.ts` — spawn/kill drizzle-kit studio per job
- `workbench/src/server/lib/ai-pipeline/edit.ts` — AI-driven schema/route edit helpers
- `workbench/src/server/lib/ai-pipeline/rebuild.ts` — re-render files + rebuild Hono image + respawn container

**Modified server files:**
- `workbench/src/server/routes/ai-pipelines.ts` — add `POST /jobs/:id/edit-schema`, `POST /jobs/:id/edit-routes`, `POST /jobs/:id/rebuild`, `POST /jobs/:id/studio/launch`, `GET /jobs/:id/artifacts`

**New client files:**
- `workbench/src/client/pages/JobApiPage.tsx`
- `workbench/src/client/components/PipelineStatusPanel.tsx`
- `workbench/src/client/components/SchemaViewer.tsx`
- `workbench/src/client/components/RouteEditor.tsx`
- `workbench/src/client/components/AiChatPanel.tsx`
- `workbench/src/client/components/StudioLaunchButton.tsx`

**Modified client files:**
- `workbench/src/client/lib/api.ts` — add `pipelines` resource
- `workbench/src/client/lib/hooks.ts` — add hooks (`usePipelineRuns`, `useArtifacts`, `useEditSchema`, `useEditRoutes`, `useRebuild`, `useStudioLaunch`)
- `workbench/src/client/App.tsx` — register `/scrapes/:id/api` route
- `workbench/src/client/pages/ScrapeDetailPage.tsx` — add a small `PipelineStatusPanel` summary + link to the JobApiPage

---

## Task 1: Add `pipelines` resource to client api.ts

**Files:** `workbench/src/client/lib/api.ts`

- [ ] **Step 1: Append to api.ts**

Add a new exported object alongside the existing resources:

```typescript
export const pipelines = {
  runs: (jobId: number) => request<any[]>(`/ai/jobs/${jobId}/pipeline`),
  getRun: (id: number) => request<any>(`/ai/pipeline-runs/${id}`),
  artifacts: (jobId: number) => request<{ schemaSpec: any | null; routeSet: any | null; routeSource: string | null; schemaSource: string | null; honoServices: any[] }>(`/ai/jobs/${jobId}/artifacts`),
  start: (jobId: number, data: { mode?: string } = {}) =>
    request<any>(`/ai/jobs/${jobId}/pipeline`, { method: "POST", body: JSON.stringify(data) }),
  rerun: (jobId: number, phase: "schema" | "data" | "api") =>
    request<any>(`/ai/jobs/${jobId}/pipeline/${phase}/rerun`, { method: "POST", body: JSON.stringify({}) }),
  editSchema: (jobId: number, prompt: string) =>
    request<{ schemaSpec: any; schemaSource: string }>(`/ai/jobs/${jobId}/edit-schema`, { method: "POST", body: JSON.stringify({ prompt }) }),
  editRoutes: (jobId: number, prompt: string) =>
    request<{ routeSet: any; routeSource: string }>(`/ai/jobs/${jobId}/edit-routes`, { method: "POST", body: JSON.stringify({ prompt }) }),
  rebuild: (jobId: number) =>
    request<{ honoServiceId: number; port: number }>(`/ai/jobs/${jobId}/rebuild`, { method: "POST", body: JSON.stringify({}) }),
  destroyApi: (jobId: number) =>
    request<{ ok: boolean; services: number; datasetCleaned: boolean; diskCleaned: boolean }>(`/ai/jobs/${jobId}/api`, { method: "DELETE" }),
  studioLaunch: (jobId: number) =>
    request<{ url: string; port: number }>(`/ai/jobs/${jobId}/studio/launch`, { method: "POST", body: JSON.stringify({}) })
};
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/lib/api.ts
git commit -m "feat(client): add pipelines resource to api.ts"
```

---

## Task 2: Add server edit helpers (`edit.ts`)

**Files:** `workbench/src/server/lib/ai-pipeline/edit.ts`

- [ ] **Step 1: Implement**

```typescript
import path from "node:path";
import fs from "node:fs";
import { db } from "../db.js";
import { aiPipelines } from "../../../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { callLLMJson, type Provider, getAiSettings, PROVIDERS } from "./llm-client.js";
import { SchemaSpecSchema, RouteSetSchema, type SchemaSpec, type RouteSet } from "./types.js";
import { renderDrizzleSchema, persistSchemaToDisk } from "./schema-gen.js";
import { renderRouteFile, persistRoutesToDisk } from "./route-gen.js";
import { startPipelineRun, completePipelineRun, failPipelineRun } from "./store.js";

const JOBS_DIR = path.join(process.cwd(), "jobs");

const SCHEMA_EDIT_SYSTEM = `You are editing an existing SchemaSpec. The user gives a natural-language change request. Apply the change and return the FULL updated SchemaSpec (not a diff). Same SchemaSpec rules as before: snake_case identifiers, allowed types {text, integer, real, boolean, timestamp, jsonb}, always include "id" primary key. Return ONLY the JSON object.`;

const ROUTES_EDIT_SYSTEM = `You are editing an existing RouteSet. The user gives a natural-language change request (often "add a route that..."). Return the FULL updated RouteSet with the new/modified routes included alongside existing ones. handlerSource rules unchanged. Return ONLY the JSON object.`;

async function getLatestSchemaSpec(jobId: number): Promise<SchemaSpec | null> {
  const [row] = await db.select().from(aiPipelines)
    .where(and(eq(aiPipelines.jobId, jobId), eq(aiPipelines.phase, "schema"), eq(aiPipelines.status, "completed")))
    .orderBy(desc(aiPipelines.id)).limit(1);
  if (!row || !row.output) return null;
  return (row.output as { schemaSpec?: SchemaSpec }).schemaSpec ?? null;
}

async function getLatestRouteSet(jobId: number): Promise<RouteSet | null> {
  const [row] = await db.select().from(aiPipelines)
    .where(and(eq(aiPipelines.jobId, jobId), eq(aiPipelines.phase, "api"), eq(aiPipelines.status, "completed")))
    .orderBy(desc(aiPipelines.id)).limit(1);
  if (!row || !row.output) return null;
  return (row.output as { routeSet?: RouteSet }).routeSet ?? null;
}

export async function editSchemaWithAi(jobId: number, prompt: string): Promise<{ schemaSpec: SchemaSpec; schemaSource: string }> {
  const settings = await getAiSettings();
  if (!settings) throw new Error("No AI provider configured");
  const provider = settings.provider as Provider;
  const model = PROVIDERS[provider].model;

  const current = await getLatestSchemaSpec(jobId);
  if (!current) throw new Error("No existing schema found; run the schema phase first");

  const run = await startPipelineRun({ jobId, phase: "schema", provider, model, inputSummary: { edit: true, prompt } });
  try {
    const userPrompt = `Current SchemaSpec:\n${JSON.stringify(current, null, 2)}\n\nUser change request: ${prompt}\n\nReturn the full updated SchemaSpec JSON.`;
    const updated = await callLLMJson(provider, settings.apiKey, SCHEMA_EDIT_SYSTEM, userPrompt, SchemaSpecSchema);
    persistSchemaToDisk(jobId, updated, JOBS_DIR);
    const schemaSource = renderDrizzleSchema(updated);
    await completePipelineRun(run.id, { output: { schemaSpec: updated, edit: true } });
    return { schemaSpec: updated, schemaSource };
  } catch (err) {
    await failPipelineRun(run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function editRoutesWithAi(jobId: number, prompt: string): Promise<{ routeSet: RouteSet; routeSource: string }> {
  const settings = await getAiSettings();
  if (!settings) throw new Error("No AI provider configured");
  const provider = settings.provider as Provider;
  const model = PROVIDERS[provider].model;

  const schemaSpec = await getLatestSchemaSpec(jobId);
  if (!schemaSpec) throw new Error("No schema found; run the schema phase first");
  const current = await getLatestRouteSet(jobId);
  if (!current) throw new Error("No existing routes found; run the api phase first");

  const run = await startPipelineRun({ jobId, phase: "api", provider, model, inputSummary: { edit: true, prompt } });
  try {
    const userPrompt = `Current SchemaSpec:\n${JSON.stringify(schemaSpec, null, 2)}\n\nCurrent RouteSet:\n${JSON.stringify(current, null, 2)}\n\nUser change request: ${prompt}\n\nReturn the full updated RouteSet JSON.`;
    const updated = await callLLMJson(provider, settings.apiKey, ROUTES_EDIT_SYSTEM, userPrompt, RouteSetSchema);
    const source = renderRouteFile(updated, schemaSpec);
    persistRoutesToDisk(jobId, updated.resource, source, JOBS_DIR);
    await completePipelineRun(run.id, { output: { routeSet: updated, edit: true } });
    return { routeSet: updated, routeSource: source };
  } catch (err) {
    await failPipelineRun(run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function getJobArtifacts(jobId: number) {
  const schemaSpec = await getLatestSchemaSpec(jobId);
  const routeSet = await getLatestRouteSet(jobId);
  const schemaSource = schemaSpec ? renderDrizzleSchema(schemaSpec) : null;
  const routeSource = (schemaSpec && routeSet) ? renderRouteFile(routeSet, schemaSpec) : null;

  // Hono services for this job
  const { honoServices } = await import("../../../db/schema.js");
  const services = await db.select().from(honoServices).where(eq(honoServices.jobId, jobId)).orderBy(desc(honoServices.id));

  return { schemaSpec, routeSet, schemaSource, routeSource, honoServices: services };
}
```

- [ ] **Step 2: Type check + commit**

```bash
cd /home/jake/Programming/tools/product-scraper/workbench
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/lib/ai-pipeline/edit.ts
git commit -m "feat(ai-pipeline): edit.ts (AI-driven schema/route edits + artifact loader)"
```

---

## Task 3: `rebuild.ts` server module

**Files:** `workbench/src/server/lib/ai-pipeline/rebuild.ts`

- [ ] **Step 1: Implement**

```typescript
import path from "node:path";
import { db } from "../db.js";
import { honoServices, datasets } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { destroyHonoService, buildAndSpawnHonoService } from "./hono-builder.js";
import { renderDrizzleSchema } from "./schema-gen.js";
import { containers } from "../../../db/schema.js";

const JOBS_DIR = path.join(process.cwd(), "jobs");

export async function rebuildHonoServiceForJob(jobId: number): Promise<{ honoServiceId: number; port: number }> {
  // Destroy any existing hono services for this job.
  const existing = await db.select().from(honoServices).where(eq(honoServices.jobId, jobId));
  for (const s of existing) {
    await destroyHonoService(s.id).catch(() => { /* ignore */ });
  }

  // Find the latest dataset and its DB credentials for the connection URL.
  const [ds] = await db.select().from(datasets)
    .where(eq(datasets.sourceJobId, jobId))
    .orderBy(desc(datasets.id)).limit(1);
  if (!ds || !ds.databasePort || !ds.databaseContainerId) {
    throw new Error("Dataset DB not available for this job");
  }
  const [creds] = await db.select({
    user: containers.dbUser, password: containers.password, dbName: containers.dbName
  }).from(containers).where(eq(containers.datasetId, ds.id)).orderBy(desc(containers.id)).limit(1);
  if (!creds) throw new Error("Container credentials not found for dataset");

  const dbUrl = `postgres://${creds.user}:${encodeURIComponent(creds.password)}@host.docker.internal:${ds.databasePort}/${creds.dbName}`;

  // Read the current schema spec from disk
  const fs = await import("node:fs");
  const schemaTsPath = path.join(JOBS_DIR, String(jobId), "schema.ts");
  if (!fs.existsSync(schemaTsPath)) {
    throw new Error(`Generated schema.ts not found for job ${jobId}; run pipeline first`);
  }
  const schemaSource = fs.readFileSync(schemaTsPath, "utf-8");

  const built = await buildAndSpawnHonoService({
    jobId, jobsDir: JOBS_DIR, schemaSource, jobDbConnectionUrl: dbUrl
  });
  return { honoServiceId: built.honoServiceId, port: built.port };
}
```

- [ ] **Step 2: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/lib/ai-pipeline/rebuild.ts
git commit -m "feat(ai-pipeline): rebuild.ts (destroy old service + respawn from current artifacts)"
```

---

## Task 4: `studio-launcher.ts` server module

**Files:** `workbench/src/server/lib/ai-pipeline/studio-launcher.ts`

- [ ] **Step 1: Implement**

```typescript
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

  const [creds] = await db.select({ user: containers.dbUser, password: containers.password, dbName: containers.dbName })
    .from(containers).where(eq(containers.datasetId, ds.id)).orderBy(desc(containers.id)).limit(1);
  if (!creds) throw new Error("Container credentials not found");

  const url = `postgres://${creds.user}:${encodeURIComponent(creds.password)}@localhost:${ds.databasePort}/${creds.dbName}`;

  // Generate a per-job drizzle.config.ts under workbench/jobs/<jobId>/drizzle.config.ts
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
    cwd: path.join(process.cwd()),
    detached: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc.on("exit", () => {
    usedPorts.delete(port);
    activeStudios.delete(jobId);
  });

  activeStudios.set(jobId, { jobId, port, proc, startedAt: Date.now() });

  // drizzle-kit studio takes a moment to bind. Return the URL eagerly.
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
```

- [ ] **Step 2: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/lib/ai-pipeline/studio-launcher.ts
git commit -m "feat(ai-pipeline): studio-launcher spawns drizzle-kit studio per job"
```

---

## Task 5: New REST endpoints in `routes/ai-pipelines.ts`

**Files:** `workbench/src/server/routes/ai-pipelines.ts`

- [ ] **Step 1: Add imports**

At the top of the file, add:

```typescript
import { editSchemaWithAi, editRoutesWithAi, getJobArtifacts } from "../lib/ai-pipeline/edit.js";
import { rebuildHonoServiceForJob } from "../lib/ai-pipeline/rebuild.js";
import { launchStudioForJob } from "../lib/ai-pipeline/studio-launcher.js";
```

- [ ] **Step 2: Add the four new routes inside the `app` block (before `export default app;`)**

```typescript
app.get("/jobs/:id/artifacts", async (c) => {
  const jobId = Number(c.req.param("id"));
  if (!Number.isInteger(jobId) || jobId <= 0) return c.json({ error: "Invalid job id" }, 400);
  const result = await getJobArtifacts(jobId);
  return c.json(result);
});

app.post("/jobs/:id/edit-schema", async (c) => {
  const jobId = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return c.json({ error: "prompt is required" }, 400);
  try {
    const result = await editSchemaWithAi(jobId, prompt);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/jobs/:id/edit-routes", async (c) => {
  const jobId = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return c.json({ error: "prompt is required" }, 400);
  try {
    const result = await editRoutesWithAi(jobId, prompt);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/jobs/:id/rebuild", async (c) => {
  const jobId = Number(c.req.param("id"));
  try {
    const result = await rebuildHonoServiceForJob(jobId);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/jobs/:id/studio/launch", async (c) => {
  const jobId = Number(c.req.param("id"));
  try {
    const result = await launchStudioForJob(jobId);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
```

- [ ] **Step 3: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/server/routes/ai-pipelines.ts
git commit -m "feat(ai-pipelines): REST endpoints for artifacts, edit, rebuild, studio launch"
```

---

## Task 6: Client hooks in `lib/hooks.ts`

**Files:** `workbench/src/client/lib/hooks.ts`

- [ ] **Step 1: Investigate existing hook style**

Read the file with Serena: `mcp__plugin_serena_serena__read_file relative_path="workbench/src/client/lib/hooks.ts"`. Note the pattern (likely `useQuery` / `useMutation` from `@tanstack/react-query`).

- [ ] **Step 2: Append pipeline hooks**

Add to the file:

```typescript
import * as api from "./api";
// (skip if `api` already imported above; otherwise add this import alongside the existing ones)

export function usePipelineRuns(jobId: number) {
  return useQuery({
    queryKey: ["pipeline-runs", jobId],
    queryFn: () => api.pipelines.runs(jobId),
    enabled: jobId > 0
  });
}

export function useArtifacts(jobId: number) {
  return useQuery({
    queryKey: ["job-artifacts", jobId],
    queryFn: () => api.pipelines.artifacts(jobId),
    enabled: jobId > 0
  });
}

export function useStartPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, mode }: { jobId: number; mode?: string }) =>
      api.pipelines.start(jobId, { mode }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["pipeline-runs", vars.jobId] });
      qc.invalidateQueries({ queryKey: ["job-artifacts", vars.jobId] });
    }
  });
}

export function useEditSchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, prompt }: { jobId: number; prompt: string }) =>
      api.pipelines.editSchema(jobId, prompt),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["job-artifacts", vars.jobId] });
      qc.invalidateQueries({ queryKey: ["pipeline-runs", vars.jobId] });
    }
  });
}

export function useEditRoutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, prompt }: { jobId: number; prompt: string }) =>
      api.pipelines.editRoutes(jobId, prompt),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["job-artifacts", vars.jobId] });
      qc.invalidateQueries({ queryKey: ["pipeline-runs", vars.jobId] });
    }
  });
}

export function useRebuildApi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) => api.pipelines.rebuild(jobId),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ["job-artifacts", jobId] });
    }
  });
}

export function useStudioLaunch() {
  return useMutation({
    mutationFn: (jobId: number) => api.pipelines.studioLaunch(jobId)
  });
}
```

(If the existing hooks file does NOT already import `useQuery`, `useMutation`, or `useQueryClient` from `@tanstack/react-query`, add those imports.)

- [ ] **Step 3: Type check + commit**

```bash
npx tsc -p tsconfig.server.json --noEmit
git add workbench/src/client/lib/hooks.ts
git commit -m "feat(client): hooks for pipeline runs, artifacts, edits, rebuild, studio"
```

---

## Task 7: PipelineStatusPanel component

**Files:** `workbench/src/client/components/PipelineStatusPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from "react";
import { usePipelineRuns } from "../lib/hooks";

export default function PipelineStatusPanel({ jobId }: { jobId: number }) {
  const { data: runs, isLoading } = usePipelineRuns(jobId);

  if (isLoading) return <p>Loading pipeline status...</p>;
  if (!runs || runs.length === 0) return <p style={{ opacity: 0.7 }}>No pipeline runs yet.</p>;

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <h3 style={{ margin: 0 }}>Pipeline runs</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={cell}>ID</th>
            <th style={cell}>Phase</th>
            <th style={cell}>Status</th>
            <th style={cell}>Provider</th>
            <th style={cell}>Started</th>
            <th style={cell}>Duration</th>
            <th style={cell}>Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => {
            const dur = r.completedAt && r.startedAt
              ? `${Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s`
              : "-";
            return (
              <tr key={r.id}>
                <td style={cell}>{r.id}</td>
                <td style={cell}>{r.phase}</td>
                <td style={cell}><StatusBadge status={r.status} /></td>
                <td style={cell}>{r.provider}</td>
                <td style={cell}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "-"}</td>
                <td style={cell}>{dur}</td>
                <td style={{ ...cell, color: "var(--color-error, crimson)" }}>{r.errorMessage || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const cell: React.CSSProperties = { padding: "0.25rem 0.5rem", textAlign: "left", borderBottom: "1px solid #ddd", fontSize: "0.85rem" };

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "#3b82f6", completed: "#10b981", failed: "#ef4444", pending: "#9ca3af"
  };
  return (
    <span style={{
      background: colors[status] || "#9ca3af", color: "white",
      padding: "0.1rem 0.4rem", borderRadius: "0.25rem", fontSize: "0.75rem"
    }}>{status}</span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/components/PipelineStatusPanel.tsx
git commit -m "feat(client): PipelineStatusPanel component (lists ai_pipelines runs)"
```

---

## Task 8: SchemaViewer component

**Files:** `workbench/src/client/components/SchemaViewer.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from "react";

export default function SchemaViewer({ schemaSpec, schemaSource }: { schemaSpec: any | null; schemaSource: string | null }) {
  if (!schemaSpec) return <p style={{ opacity: 0.7 }}>No schema generated yet. Run the pipeline first.</p>;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div>
        <h3 style={{ margin: "0 0 0.5rem 0" }}>Tables</h3>
        {schemaSpec.tables.map((table: any) => (
          <div key={table.name} style={{ marginBottom: "1rem", padding: "0.5rem", border: "1px solid #ddd", borderRadius: "0.25rem" }}>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{table.name}</div>
            <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={cell}>Column</th>
                  <th style={cell}>Type</th>
                  <th style={cell}>Nullable</th>
                  <th style={cell}>Description</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((c: any) => (
                  <tr key={c.name}>
                    <td style={cell}>{c.name}</td>
                    <td style={cell}><code>{c.type}</code></td>
                    <td style={cell}>{c.nullable ? "yes" : "no"}</td>
                    <td style={{ ...cell, color: "#666" }}>{c.description || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {schemaSource && (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Drizzle TS source</summary>
          <pre style={{ background: "#f5f5f5", padding: "0.5rem", overflow: "auto", fontSize: "0.8rem" }}>{schemaSource}</pre>
        </details>
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "0.25rem 0.5rem", textAlign: "left", borderBottom: "1px solid #eee" };
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/components/SchemaViewer.tsx
git commit -m "feat(client): SchemaViewer component (table view + Drizzle source)"
```

---

## Task 9: RouteEditor component (read-only viewer for now)

**Files:** `workbench/src/client/components/RouteEditor.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from "react";

export default function RouteEditor({ routeSet, routeSource }: { routeSet: any | null; routeSource: string | null }) {
  if (!routeSet) return <p style={{ opacity: 0.7 }}>No routes generated yet. Run the pipeline first.</p>;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div>
        <h3 style={{ margin: "0 0 0.5rem 0" }}>Routes (resource: <code>{routeSet.resource}</code>)</h3>
        <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cell}>Method</th>
              <th style={cell}>Path</th>
              <th style={cell}>Description</th>
            </tr>
          </thead>
          <tbody>
            {routeSet.routes.map((r: any, i: number) => (
              <tr key={i}>
                <td style={cell}><strong>{r.method}</strong></td>
                <td style={cell}><code>/{routeSet.resource}{r.path}</code></td>
                <td style={cell}>{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {routeSource && (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hono TS source</summary>
          <pre style={{ background: "#f5f5f5", padding: "0.5rem", overflow: "auto", fontSize: "0.8rem" }}>{routeSource}</pre>
        </details>
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "0.25rem 0.5rem", textAlign: "left", borderBottom: "1px solid #eee" };
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/components/RouteEditor.tsx
git commit -m "feat(client): RouteEditor component (route table + Hono source viewer)"
```

---

## Task 10: AiChatPanel component

**Files:** `workbench/src/client/components/AiChatPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
import React, { useState } from "react";
import { useEditSchema, useEditRoutes } from "../lib/hooks";

interface Props {
  jobId: number;
  target: "schema" | "routes";
  onApplied?: () => void;
}

export default function AiChatPanel({ jobId, target, onApplied }: Props) {
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<{ role: "user" | "ai"; content: string }[]>([]);
  const editSchema = useEditSchema();
  const editRoutes = useEditRoutes();

  const isWorking = editSchema.isPending || editRoutes.isPending;
  const placeholder = target === "schema"
    ? "Describe schema changes (e.g. 'Add a column tags as text nullable')"
    : "Describe a new route or change (e.g. 'Add an endpoint that lists products with price below a query parameter')";

  async function submit() {
    if (!prompt.trim()) return;
    const p = prompt;
    setHistory(h => [...h, { role: "user", content: p }]);
    setPrompt("");
    try {
      const result = target === "schema"
        ? await editSchema.mutateAsync({ jobId, prompt: p })
        : await editRoutes.mutateAsync({ jobId, prompt: p });
      setHistory(h => [...h, { role: "ai", content: target === "schema" ? "Schema updated." : "Routes updated." }]);
      onApplied?.();
    } catch (err: any) {
      setHistory(h => [...h, { role: "ai", content: `Error: ${err.message ?? String(err)}` }]);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem", border: "1px solid #ddd", padding: "0.5rem", borderRadius: "0.25rem" }}>
      <div style={{ fontWeight: 600 }}>AI {target === "schema" ? "Schema" : "Route"} Assistant</div>
      <div style={{ minHeight: "4rem", maxHeight: "10rem", overflow: "auto", fontSize: "0.85rem", background: "#fafafa", padding: "0.5rem" }}>
        {history.length === 0 && <span style={{ opacity: 0.6 }}>No edits yet.</span>}
        {history.map((m, i) => (
          <div key={i} style={{ marginBottom: "0.25rem" }}>
            <strong>{m.role === "user" ? "You: " : "AI: "}</strong>{m.content}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter" && !isWorking) submit(); }}
          disabled={isWorking}
          style={{ flex: 1, padding: "0.4rem", fontSize: "0.85rem" }}
        />
        <button onClick={submit} disabled={isWorking || !prompt.trim()} style={{ padding: "0.4rem 0.75rem" }}>
          {isWorking ? "Working..." : "Apply"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/components/AiChatPanel.tsx
git commit -m "feat(client): AiChatPanel for natural-language schema/route edits"
```

---

## Task 11: StudioLaunchButton component

**Files:** `workbench/src/client/components/StudioLaunchButton.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from "react";
import { useStudioLaunch } from "../lib/hooks";
import { useToast } from "./Toast";

export default function StudioLaunchButton({ jobId }: { jobId: number }) {
  const launch = useStudioLaunch();
  const { toast } = useToast();

  async function handleClick() {
    try {
      const result = await launch.mutateAsync(jobId);
      // Studio takes a moment to bind; small delay before redirect.
      toast(`Studio starting on port ${result.port}`, "info");
      setTimeout(() => window.open(result.url, "_blank"), 1500);
    } catch (err: any) {
      toast(`Studio launch failed: ${err.message ?? String(err)}`, "error");
    }
  }

  return (
    <button onClick={handleClick} disabled={launch.isPending} style={{ padding: "0.4rem 0.75rem" }}>
      {launch.isPending ? "Launching..." : "Open in Drizzle Studio"}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/components/StudioLaunchButton.tsx
git commit -m "feat(client): StudioLaunchButton triggers POST /studio/launch and opens tab"
```

---

## Task 12: JobApiPage page

**Files:** `workbench/src/client/pages/JobApiPage.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from "react";
import { useParams, Link } from "react-router-dom";
import { useArtifacts, useRebuildApi, useStartPipeline } from "../lib/hooks";
import { useToast } from "../components/Toast";
import PipelineStatusPanel from "../components/PipelineStatusPanel";
import SchemaViewer from "../components/SchemaViewer";
import RouteEditor from "../components/RouteEditor";
import AiChatPanel from "../components/AiChatPanel";
import StudioLaunchButton from "../components/StudioLaunchButton";

export default function JobApiPage() {
  const { id } = useParams();
  const jobId = Number(id);
  const { data, isLoading, refetch } = useArtifacts(jobId);
  const rebuild = useRebuildApi();
  const startPipeline = useStartPipeline();
  const { toast } = useToast();

  if (isLoading) return <p>Loading...</p>;

  async function handleRunPipeline() {
    try { await startPipeline.mutateAsync({ jobId }); toast("Pipeline started", "success"); refetch(); }
    catch (err: any) { toast(`Pipeline failed: ${err.message}`, "error"); }
  }
  async function handleRebuild() {
    try {
      const result = await rebuild.mutateAsync(jobId);
      toast(`API rebuilt — http://localhost:${result.port}`, "success");
      refetch();
    } catch (err: any) { toast(`Rebuild failed: ${err.message}`, "error"); }
  }

  return (
    <div style={{ display: "grid", gap: "1rem", padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Job #{jobId} — AI Pipeline</h2>
        <Link to={`/scrapes/${jobId}`}>← Back to scrape</Link>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={handleRunPipeline} disabled={startPipeline.isPending} style={{ padding: "0.4rem 0.75rem" }}>
          {startPipeline.isPending ? "Running..." : "Run pipeline"}
        </button>
        <button onClick={handleRebuild} disabled={rebuild.isPending} style={{ padding: "0.4rem 0.75rem" }}>
          {rebuild.isPending ? "Rebuilding..." : "Rebuild API service"}
        </button>
        <StudioLaunchButton jobId={jobId} />
      </div>

      <PipelineStatusPanel jobId={jobId} />

      <section style={{ display: "grid", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Schema</h3>
        <SchemaViewer schemaSpec={data?.schemaSpec ?? null} schemaSource={data?.schemaSource ?? null} />
        <AiChatPanel jobId={jobId} target="schema" onApplied={() => refetch()} />
      </section>

      <section style={{ display: "grid", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Routes</h3>
        <RouteEditor routeSet={data?.routeSet ?? null} routeSource={data?.routeSource ?? null} />
        <AiChatPanel jobId={jobId} target="routes" onApplied={() => refetch()} />
      </section>

      {data?.honoServices && data.honoServices.length > 0 && (
        <section>
          <h3 style={{ margin: 0 }}>API services</h3>
          <ul>
            {data.honoServices.map((s: any) => (
              <li key={s.id}>
                Service #{s.id} — port {s.port} — status: {s.status} — image: <code>{s.imageTag}</code>
                {s.status === "running" && <> — <a href={`http://localhost:${s.port}/health`} target="_blank" rel="noreferrer">health</a></>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add workbench/src/client/pages/JobApiPage.tsx
git commit -m "feat(client): JobApiPage composing pipeline status, schema, routes, AI chat, studio"
```

---

## Task 13: Wire route + add link from ScrapeDetailPage

**Files:**
- Modify: `workbench/src/client/App.tsx`
- Modify: `workbench/src/client/pages/ScrapeDetailPage.tsx`

- [ ] **Step 1: Register route**

In `App.tsx`, add the import and route:

```typescript
import JobApiPage from "./pages/JobApiPage";
// inside <Routes>:
<Route path="/scrapes/:id/api" element={<JobApiPage />} />
```

- [ ] **Step 2: Add link from ScrapeDetailPage**

Read the existing `ScrapeDetailPage.tsx`. Add a button/link near the existing "AI Parse" or extraction controls that navigates to `/scrapes/${jobId}/api`. Minimal addition:

```tsx
<Link
  to={`/scrapes/${jobId}/api`}
  style={{ padding: "0.4rem 0.75rem", border: "1px solid #ddd", borderRadius: "0.25rem", textDecoration: "none" }}
>
  AI Pipeline →
</Link>
```

(Place inside the action button group; the file already imports `Link` from react-router-dom.)

- [ ] **Step 3: Commit**

```bash
git add workbench/src/client/App.tsx workbench/src/client/pages/ScrapeDetailPage.tsx
git commit -m "feat(client): register /scrapes/:id/api route + ScrapeDetailPage link"
```

---

## Task 14: Smoke test (UI wiring only — no LLM spend)

**Files:** none (verification only)

- [ ] **Step 1: Bring up the dev stack**

```bash
cd /home/jake/Programming/tools/product-scraper/workbench
PG_PORT=5434 npm run up &
```

Wait ~10s.

- [ ] **Step 2: Verify Vite client builds**

Open `http://localhost:5173` in a browser (or `curl -sf http://localhost:5173 >/dev/null && echo OK`).

- [ ] **Step 3: Verify the new endpoints respond**

```bash
# Should return 400 (no prompt)
curl -s -X POST http://localhost:3000/api/ai/jobs/1/edit-schema -H "Content-Type: application/json" -d '{}'

# Should return 500 with "No existing schema found" or similar (no schema yet for job 1)
curl -s -X POST http://localhost:3000/api/ai/jobs/1/edit-schema -H "Content-Type: application/json" -d '{"prompt":"add a tags column"}'

# Artifacts endpoint should return null fields for a fresh job
curl -s http://localhost:3000/api/ai/jobs/1/artifacts | jq '.'

# Studio launch should fail gracefully if no dataset exists
curl -s -X POST http://localhost:3000/api/ai/jobs/1/studio/launch -H "Content-Type: application/json" -d '{}'
```

- [ ] **Step 4: Open `/scrapes/1/api` in the browser**

Navigate manually. Page should render without crashes even when no artifacts exist.

- [ ] **Step 5: No commit — verification only.**

If anything crashes the React tree, dispatch a fix.

---

## Self-Review

**Spec coverage:**
- Pipeline status display → Tasks 7, 12
- Schema view → Tasks 8, 12
- Route view → Tasks 9, 12
- Studio launch → Tasks 4, 11, 12
- AI-driven schema edits → Tasks 2, 5, 6, 10, 12
- AI-driven route edits → Tasks 2, 5, 6, 10, 12
- Rebuild Hono container after edits → Tasks 3, 5, 6, 12
- Page navigation from ScrapeDetailPage → Task 13
- Smoke test → Task 14

**Type consistency:** SchemaSpec, RouteSet types come from server; client treats them as `any` for now (acceptable; future plan can type-share via a shared package). Route paths and method strings consistent across server/client.

**Placeholders:** none.

**Deferred:**
- Inline editor for schema source / handler source (no Monaco / CodeMirror integration yet). Currently AI chat is the only edit path. UI-direct editing is a future enhancement.
- Studio process supervision / idle timeout — minimal in-memory tracking; OK for single-user dev.
- Real-time pipeline run updates (currently re-fetched on demand or after mutations).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-scrapekit-studio-ui.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
**2. Inline Execution** — batch execution with checkpoints

Which approach?
