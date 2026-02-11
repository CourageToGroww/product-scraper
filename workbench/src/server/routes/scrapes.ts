import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { scrapeJobs, scrapeResults } from "../../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";

import { validateBody, type Env } from "../middleware/validate.js";
import { adapter } from "../lib/scrapekit-adapter.js";
import { expandUrlPattern, runApiScrapeJob, detectApiPagination, quickDetectUrlType } from "../lib/api-scrape-adapter.js";
import { datasets, datasetRows } from "../../db/schema.js";
import { dashboards, charts } from "../../db/schema.js";
import { destroyJobDatabase, loadRegistry, saveRegistry, regenerateComposeFile } from "../lib/docker-manager.js";
import { discoverUrls } from "../lib/url-discovery.js";

const app = new Hono<Env>();

const createScrapeSchema = z.object({
  name: z.string().min(1).max(200),
  urls: z.array(z.string().min(1)).min(1).max(5000),
  // Optional type — auto-detected from first URL if omitted
  type: z.enum(["api", "web"]).optional(),
  // Web scrape options (ignored for API scrapes)
  options: z.object({
    jsRender: z.boolean().optional(),
    stealth: z.boolean().optional(),
    timeout: z.number().int().positive().optional(),
    concurrency: z.number().int().positive().max(20).optional(),
    delay: z.number().int().min(0).optional(),
    headers: z.record(z.string()).optional(),
    cookie: z.string().optional(),
    proxy: z.string().optional(),
    proxyCountry: z.string().max(2).optional(),
    rotateUa: z.boolean().optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
    requestBody: z.string().optional(),
    device: z.string().optional(),
    windowWidth: z.number().int().positive().optional(),
    windowHeight: z.number().int().positive().optional(),
    waitFor: z.string().optional(),
    waitForEvent: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2", "requestsfinished"]).optional(),
    wait: z.number().int().min(0).optional(),
    blockResources: z.array(z.string()).optional(),
    antiBot: z.boolean().optional(),
    session: z.boolean().optional(),
    captchaKey: z.string().optional(),
    allowedStatus: z.string().optional(),
    responseType: z.enum(["html", "markdown", "plaintext"]).optional(),
    screenshot: z.string().optional(),
    screenshotFormat: z.enum(["png", "jpeg"]).optional(),
    screenshotQuality: z.number().int().min(1).max(100).optional(),
    screenshotBase64: z.boolean().optional(),
    pdf: z.boolean().optional(),
    jsInstructions: z.array(z.record(z.unknown())).optional(),
    jsonResponse: z.array(z.string()).optional()
  }).optional().default({}),
  scrapeOpts: z.object({
    output: z.string().optional(),
    extract: z.string().optional(),
    autoParse: z.string().optional(),
    downloadImages: z.boolean().optional()
  }).optional().default({}),
  extractionConfig: z.object({
    mode: z.enum(["css", "autoparse", "convert", "list"]),
    config: z.record(z.unknown()),
    datasetName: z.string().min(1).max(200).optional()
  }).optional(),
  // Shared options (apply to both web and API)
  headers: z.record(z.string()).optional(),
  delay: z.number().int().min(0).max(10000).optional(),
  timeout: z.number().int().min(1000).max(120000).optional()
});

// Create + start scrape job — auto-detects API vs web from URL response
app.post("/", async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = createScrapeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ") }, 400);
  }
  const body = parsed.data;

  // Expand URL patterns ([1-50] syntax)
  const expandedUrls = body.urls.flatMap(expandUrlPattern);
  if (expandedUrls.length === 0) return c.json({ error: "No URLs after pattern expansion" }, 400);
  if (expandedUrls.length > 5000) return c.json({ error: `Too many URLs (${expandedUrls.length}). Max 5000.` }, 400);

  // Merge headers: top-level headers + options.headers (top-level takes precedence for API compat)
  const mergedHeaders = { ...body.options.headers, ...body.headers };

  // Auto-detect type if not explicitly provided
  let jobType = body.type;
  let detectedFormat: string | undefined;
  if (!jobType) {
    try {
      const detection = await quickDetectUrlType(expandedUrls[0], Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined);
      jobType = detection.type;
      detectedFormat = detection.detectedFormat;
    } catch {
      jobType = "web"; // Default to web on detection failure
    }
  }

  if (jobType === "api") {
    // --- API scrape path ---
    const [job] = await db.insert(scrapeJobs).values({
      name: body.name,
      urls: expandedUrls,
      config: { type: "api", detectedFormat, headers: mergedHeaders, delay: body.delay || body.options.delay, timeout: body.timeout || body.options.timeout }
    }).returning();

    runApiScrapeJob(job.id, {
      urls: expandedUrls,
      headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
      delay: body.delay || body.options.delay,
      timeout: body.timeout || body.options.timeout
    }).catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api-scrape:${job.id}] Unhandled error: ${message}`);
      await db.update(scrapeJobs)
        .set({ status: "failed", completedAt: new Date(), errorMessage: message })
        .where(eq(scrapeJobs.id, job.id))
        .catch(() => {});
    });

    return c.json(job, 201);
  }

  // --- Web scrape path ---
  // Merge delay/timeout into options if set at top level
  const options = { ...body.options };
  if (body.headers && Object.keys(body.headers).length > 0) {
    options.headers = mergedHeaders;
  }
  if (body.delay != null && !options.delay) options.delay = body.delay;
  if (body.timeout != null && !options.timeout) options.timeout = body.timeout;

  const [job] = await db.insert(scrapeJobs).values({
    name: body.name,
    urls: expandedUrls,
    config: { type: "web", detectedFormat, options, scrapeOpts: body.scrapeOpts, extractionConfig: body.extractionConfig }
  }).returning();

  adapter.runJob(job.id, {
    urls: expandedUrls,
    options,
    scrapeOpts: body.scrapeOpts,
    extractionConfig: body.extractionConfig
  }).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scrape:${job.id}] Unhandled error: ${message}`);
    await db.update(scrapeJobs)
      .set({ status: "failed", completedAt: new Date(), errorMessage: message })
      .where(eq(scrapeJobs.id, job.id))
      .catch(() => {});
  });

  return c.json(job, 201);
});

// Auto-detect API pagination from a single URL
const detectSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional()
});

app.post("/api-detect", validateBody(detectSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof detectSchema>;
  try {
    const result = await detectApiPagination(body.url, body.headers);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Detection failed: ${msg}` }, 500);
  }
});

// Discover URLs from a site (sitemap + crawling)
const discoverSchema = z.object({
  url: z.string().url(),
  method: z.enum(["auto", "sitemap", "crawl"]).optional().default("auto"),
  maxUrls: z.number().int().min(1).max(5000).optional().default(2000),
  maxDepth: z.number().int().min(1).max(10).optional().default(3),
  pathPrefix: z.string().optional(),
  jsRender: z.boolean().optional().default(false)
});

app.post("/discover", validateBody(discoverSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof discoverSchema>;

  try {
    const result = await discoverUrls(body.url, {
      method: body.method,
      pathPrefix: body.pathPrefix,
      maxUrls: body.maxUrls,
      maxDepth: body.maxDepth,
      jsRender: body.jsRender
    });
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Discovery failed: ${msg}` }, 500);
  }
});

// Reset everything — destroy all per-job containers, clear all tables
app.post("/reset", async (c) => {
  const errors: string[] = [];

  // 1. Destroy all per-job database containers
  const registry = loadRegistry();
  for (const entry of registry) {
    try {
      await destroyJobDatabase(entry.containerId);
    } catch (err) {
      errors.push(`Container ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Clear registry (keeps main-db, just removes per-job entries)
  saveRegistry([]);
  regenerateComposeFile();

  // 2. Clear all tables (order matters for FK constraints)
  await db.delete(charts);
  await db.delete(datasetRows);
  await db.delete(scrapeResults);
  await db.delete(datasets);
  await db.delete(dashboards);
  await db.delete(scrapeJobs);

  // 3. Reset sequences so IDs start from 1
  await db.execute(sql`ALTER SEQUENCE scrape_jobs_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE scrape_results_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE datasets_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE dataset_rows_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE dashboards_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE charts_id_seq RESTART WITH 1`);

  return c.json({
    reset: true,
    containersRemoved: registry.length,
    errors: errors.length > 0 ? errors : undefined
  });
});

// List scrape jobs
app.get("/", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const jobs = await db.select()
    .from(scrapeJobs)
    .orderBy(desc(scrapeJobs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ jobs, limit, offset });
});

// Get scrape job + results
app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id));
  if (!job) return c.json({ error: "Not found" }, 404);

  const results = await db.select().from(scrapeResults).where(eq(scrapeResults.jobId, id));

  return c.json({ ...job, results });
});

// Delete scrape job (cascade deletes results)
app.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [deleted] = await db.delete(scrapeJobs)
    .where(eq(scrapeJobs.id, id))
    .returning({ id: scrapeJobs.id });

  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ deleted: true, id: deleted.id });
});

export default app;
