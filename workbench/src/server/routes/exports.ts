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
    const { tarPath } = await packDir(bundle.dir);
    const buf = fs.readFileSync(tarPath);
    return new Response(buf, {
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
