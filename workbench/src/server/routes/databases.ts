import { Hono } from "hono";
import { z } from "zod";
import fs from "node:fs";
import { validateBody, type Env } from "../middleware/validate.js";
import {
  loadRegistry, saveRegistry,
  getContainerStatus, connectionUrl,
  createDatabase, destroyJobDatabase, exportJobDatabase,
  startDatabase, stopDatabase,
  EXPORT_DIR,
  type ProjectDb
} from "../lib/docker-manager.js";

const app = new Hono<Env>();

const createDbSchema = z.object({
  name: z.string().min(1).max(100)
});

// List all project databases
app.get("/", async (c) => {
  const dbs = loadRegistry();

  for (const entry of dbs) {
    entry.status = await getContainerStatus(entry.containerId);
  }
  saveRegistry(dbs);

  return c.json({ databases: dbs });
});

// Create new project database
app.post("/", validateBody(createDbSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof createDbSchema>;
  const entry = await createDatabase(body.name);
  return c.json(entry, 201);
});

// Start a stopped database
app.post("/:id/start", async (c) => {
  const id = c.req.param("id");
  const dbs = loadRegistry();
  const entry = dbs.find(d => d.id === id);
  if (!entry) return c.json({ error: "Not found" }, 404);

  try {
    startDatabase(entry);
    entry.status = "running";
    saveRegistry(dbs);
    return c.json(entry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to start: ${msg}` }, 500);
  }
});

// Stop a running database
app.post("/:id/stop", async (c) => {
  const id = c.req.param("id");
  const dbs = loadRegistry();
  const entry = dbs.find(d => d.id === id);
  if (!entry) return c.json({ error: "Not found" }, 404);

  try {
    stopDatabase(entry);
    entry.status = "stopped";
    saveRegistry(dbs);
    return c.json(entry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to stop: ${msg}` }, 500);
  }
});

// Export database
app.post("/:id/export", async (c) => {
  const id = c.req.param("id");
  const dbs = loadRegistry();
  const entry = dbs.find(d => d.id === id);
  if (!entry) return c.json({ error: "Not found" }, 404);

  try {
    const result = await exportJobDatabase(entry.containerId, entry.id);
    return c.json({
      exported: true,
      dir: result.dir,
      dumpPath: result.dumpPath,
      dockerfilePath: result.dockerfilePath,
      composePath: result.composePath,
      size: result.size,
      sizeHuman: result.size > 1_048_576
        ? `${(result.size / 1_048_576).toFixed(1)} MB`
        : `${(result.size / 1024).toFixed(1)} KB`,
      database: entry
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Export failed: ${msg}` }, 500);
  }
});

// Import database from dump
app.post("/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.path || !body?.name) {
    return c.json({ error: "Requires 'path' and 'name' fields" }, 400);
  }

  if (!fs.existsSync(body.path)) {
    return c.json({ error: "Export file not found" }, 404);
  }

  const entry = await createDatabase(body.name);
  return c.json(entry, 201);
});

// Delete database permanently
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const dbs = loadRegistry();
  const entry = dbs.find(d => d.id === id);
  if (!entry) return c.json({ error: "Not found" }, 404);

  await destroyJobDatabase(entry.containerId);
  return c.json({ deleted: true, id });
});

// Get Drizzle Studio connection URL
app.get("/:id/studio", async (c) => {
  const id = c.req.param("id");
  const dbs = loadRegistry();
  const entry = dbs.find(d => d.id === id);
  if (!entry) return c.json({ error: "Not found" }, 404);

  const url = connectionUrl(entry.port);
  return c.json({
    connectionUrl: url,
    studioCommand: `DATABASE_URL="${url}" npx drizzle-kit studio`
  });
});

// Set active database for workbench session
app.post("/:id/connect", async (c) => {
  const id = c.req.param("id");
  const dbs = loadRegistry();
  const entry = dbs.find(d => d.id === id);
  if (!entry) return c.json({ error: "Not found" }, 404);

  if (entry.status !== "running") {
    return c.json({ error: "Database is not running. Start it first." }, 400);
  }

  process.env.DATABASE_URL = connectionUrl(entry.port);

  return c.json({
    connected: true,
    database: entry,
    connectionUrl: process.env.DATABASE_URL
  });
});

export default app;
