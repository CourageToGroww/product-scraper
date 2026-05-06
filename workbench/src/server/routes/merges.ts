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
