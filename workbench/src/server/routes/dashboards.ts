import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { dashboards, charts } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { validateBody, type Env } from "../middleware/validate.js";

const app = new Hono<Env>();

const createDashboardSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  layout: z.record(z.unknown()).optional()
});

const updateDashboardSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  layout: z.record(z.unknown()).optional()
});

const createChartSchema = z.object({
  name: z.string().min(1).max(200),
  chartType: z.enum(["bar", "line", "pie", "scatter", "area", "stat", "table"]),
  datasetId: z.number().int().optional(),
  config: z.record(z.unknown()),
  position: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive()
  })
});

const updateChartSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  chartType: z.enum(["bar", "line", "pie", "scatter", "area", "stat", "table"]).optional(),
  datasetId: z.number().int().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive()
  }).optional()
});

// List dashboards
app.get("/", async (c) => {
  const result = await db.select()
    .from(dashboards)
    .orderBy(desc(dashboards.createdAt));

  return c.json({ dashboards: result });
});

// Create dashboard
app.post("/", validateBody(createDashboardSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof createDashboardSchema>;

  const [dashboard] = await db.insert(dashboards).values({
    name: body.name,
    description: body.description || null,
    layout: body.layout || {}
  }).returning();

  return c.json(dashboard, 201);
});

// Get dashboard + charts
app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [dashboard] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  if (!dashboard) return c.json({ error: "Not found" }, 404);

  const chartList = await db.select()
    .from(charts)
    .where(eq(charts.dashboardId, id));

  return c.json({ ...dashboard, charts: chartList });
});

// Update dashboard
app.put("/:id", validateBody(updateDashboardSchema), async (c) => {
  const id = parseInt(c.req.param("id")!);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const body = c.get("validatedBody") as z.infer<typeof updateDashboardSchema>;

  const [updated] = await db.update(dashboards)
    .set(body)
    .where(eq(dashboards.id, id))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// Delete dashboard (cascade deletes charts)
app.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [deleted] = await db.delete(dashboards)
    .where(eq(dashboards.id, id))
    .returning({ id: dashboards.id });

  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ deleted: true, id: deleted.id });
});

// Add chart to dashboard
app.post("/:id/charts", validateBody(createChartSchema), async (c) => {
  const dashboardId = parseInt(c.req.param("id")!);
  if (isNaN(dashboardId)) return c.json({ error: "Invalid ID" }, 400);

  // Verify dashboard exists
  const [dashboard] = await db.select({ id: dashboards.id })
    .from(dashboards)
    .where(eq(dashboards.id, dashboardId));
  if (!dashboard) return c.json({ error: "Dashboard not found" }, 404);

  const body = c.get("validatedBody") as z.infer<typeof createChartSchema>;

  const [chart] = await db.insert(charts).values({
    dashboardId,
    name: body.name,
    chartType: body.chartType,
    datasetId: body.datasetId || null,
    config: body.config,
    position: body.position
  }).returning();

  return c.json(chart, 201);
});

// Update chart
app.put("/charts/:chartId", validateBody(updateChartSchema), async (c) => {
  const chartId = parseInt(c.req.param("chartId")!);
  if (isNaN(chartId)) return c.json({ error: "Invalid ID" }, 400);

  const body = c.get("validatedBody") as z.infer<typeof updateChartSchema>;

  const [updated] = await db.update(charts)
    .set(body)
    .where(eq(charts.id, chartId))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// Delete chart
app.delete("/charts/:chartId", async (c) => {
  const chartId = parseInt(c.req.param("chartId"));
  if (isNaN(chartId)) return c.json({ error: "Invalid ID" }, 400);

  const [deleted] = await db.delete(charts)
    .where(eq(charts.id, chartId))
    .returning({ id: charts.id });

  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ deleted: true, id: deleted.id });
});

export default app;
