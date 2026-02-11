import { Hono } from "hono";
import { z } from "zod";
import { createRequire } from "node:module";
import path from "node:path";
import { db } from "../lib/db.js";
import { scrapeJobs, scrapeResults, datasets, datasetRows } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { spawnDatasetDatabase } from "../lib/docker-manager.js";
import { validateBody, type Env } from "../middleware/validate.js";

const require = createRequire(import.meta.url);
const SCRAPEKIT_ROOT = path.resolve(import.meta.dirname, "../../../../");

// Lazy-load extractors (CJS modules)
function loadCssExtractor() {
  const CssExtractor = require(path.join(SCRAPEKIT_ROOT, "lib/extractors/css-extractor"));
  return new CssExtractor();
}
function loadAutoParser() {
  const AutoParser = require(path.join(SCRAPEKIT_ROOT, "lib/extractors/auto-parser"));
  return new AutoParser();
}
function loadResponseConverter() {
  const ResponseConverter = require(path.join(SCRAPEKIT_ROOT, "lib/core/response-converter"));
  return new ResponseConverter();
}

const app = new Hono<Env>();

// --- Helpers ---

async function getResultsWithHtml(jobId: number, resultId?: number) {
  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId));
  if (!job) throw new Error("Job not found");

  if (resultId) {
    return db.select().from(scrapeResults).where(eq(scrapeResults.id, resultId));
  }
  return db.select().from(scrapeResults).where(eq(scrapeResults.jobId, jobId));
}

function loadCheerio() {
  return require(path.join(SCRAPEKIT_ROOT, "node_modules/cheerio"));
}
function loadSemanticParser() {
  return require(path.join(SCRAPEKIT_ROOT, "lib/extractors/semantic-parser"));
}

/**
 * Fire-and-forget: spawn a per-dataset Docker DB with typed columns.
 * Updates the dataset record with database info on success.
 * If Docker is unavailable, silently sets status to "none".
 */
function spawnDatasetDatabaseAsync(
  datasetId: number,
  datasetName: string,
  schemaColumns: string[],
  rows: Record<string, unknown>[]
): void {
  // Mark as "creating"
  db.update(datasets)
    .set({ databaseStatus: "creating" })
    .where(eq(datasets.id, datasetId))
    .then(() => {})
    .catch(() => {});

  spawnDatasetDatabase(datasetId, datasetName, schemaColumns, rows)
    .then((spawn) => {
      db.update(datasets)
        .set({
          databasePort: spawn.port,
          databaseContainerId: spawn.containerId,
          databaseStatus: "running"
        })
        .where(eq(datasets.id, datasetId))
        .then(() => {})
        .catch(() => {});
    })
    .catch(() => {
      // Docker unavailable or failed — dataset still works via main DB
      db.update(datasets)
        .set({ databaseStatus: "none" })
        .where(eq(datasets.id, datasetId))
        .then(() => {})
        .catch(() => {});
    });
}

export function runExtraction(html: string, mode: string, config: any): any {
  switch (mode) {
    case "css": {
      const extractor = loadCssExtractor();
      return extractor.extract(html, config.selectors);
    }
    case "autoparse": {
      const parser = loadAutoParser();
      return parser.parse(html, config.categories || ["all"]);
    }
    case "convert": {
      const converter = loadResponseConverter();
      return { content: converter.convert(html, config.format || "markdown") };
    }
    case "list": {
      const wrapper = config.wrapper as string;
      const fields = config.fields as Record<string, string>;
      if (!wrapper || !fields || typeof fields !== "object") {
        throw new Error("List mode requires 'wrapper' (CSS selector) and 'fields' (name→selector map)");
      }
      const cheerio = loadCheerio();
      const $ = cheerio.load(html);
      const items: Record<string, string | null>[] = [];

      $(wrapper).each((_: number, el: any) => {
        const $el = $(el);
        const item: Record<string, string | null> = {};

        for (const [name, rawSel] of Object.entries(fields)) {
          const sel = String(rawSel).trim();

          if (sel === "" || sel === ".") {
            // Wrapper's own text content
            item[name] = $el.text().trim() || null;
          } else if (sel.startsWith("@")) {
            // Wrapper's own attribute
            item[name] = $el.attr(sel.slice(1)) || null;
          } else if (sel.includes(" @")) {
            // Sub-selector + attribute (e.g. "img @src", "a @href")
            const [subSel, attr] = sel.split(" @");
            item[name] = $el.find(subSel.trim()).first().attr(attr.trim()) || null;
          } else {
            // Sub-selector text content
            item[name] = $el.find(sel).first().text().trim() || null;
          }
        }

        // Skip empty items (all null)
        if (Object.values(item).some(v => v !== null)) {
          items.push(item);
        }
      });

      return items; // Returns array, not object
    }
    default:
      throw new Error(`Unknown extraction mode: ${mode}`);
  }
}

// --- Schemas ---

const extractSchema = z.object({
  jobId: z.number().int(),
  resultId: z.number().int().optional(),
  mode: z.enum(["css", "autoparse", "convert", "list"]),
  config: z.record(z.unknown())
});

const toDatasetSchema = z.object({
  jobId: z.number().int(),
  mode: z.enum(["css", "autoparse", "convert", "list"]),
  config: z.record(z.unknown()),
  datasetName: z.string().min(1).max(200)
});

const singleToDatasetSchema = z.object({
  jobId: z.number().int(),
  resultId: z.number().int(),
  mode: z.enum(["css", "autoparse", "convert", "list"]),
  config: z.record(z.unknown()),
  datasetName: z.string().min(1).max(200)
});

// --- Routes ---

// Preview extraction on a single result (or first result if no resultId)
app.post("/preview", validateBody(extractSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof extractSchema>;
  const results = await getResultsWithHtml(body.jobId, body.resultId);

  if (results.length === 0) {
    return c.json({ error: "No results found" }, 404);
  }

  const result = results[0];
  if (!result.rawHtml) {
    return c.json({
      error: "Raw HTML not available for this result. Re-scrape to capture HTML."
    }, 400);
  }

  try {
    const extracted = runExtraction(result.rawHtml, body.mode, body.config);
    return c.json({ url: result.url, data: extracted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Extraction failed: ${msg}` }, 400);
  }
});

// Batch extract across all results for a job
app.post("/batch", validateBody(extractSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof extractSchema>;
  const results = await getResultsWithHtml(body.jobId);

  if (results.length === 0) {
    return c.json({ error: "No results found" }, 404);
  }

  const withHtml = results.filter((r: any) => r.rawHtml);
  if (withHtml.length === 0) {
    return c.json({
      error: "No results have raw HTML stored. Re-scrape to capture HTML."
    }, 400);
  }

  const extracted: { url: string; data: any }[] = [];
  const errors: { url: string; error: string }[] = [];

  for (const r of withHtml) {
    try {
      const data = runExtraction(r.rawHtml!, body.mode, body.config);
      extracted.push({ url: r.url, data });
    } catch (err) {
      errors.push({
        url: r.url,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return c.json({
    results: extracted,
    totalResults: results.length,
    extractedCount: extracted.length,
    skippedNoHtml: results.length - withHtml.length,
    errors: errors.length > 0 ? errors : undefined
  });
});

// Extract + save directly as dataset
app.post("/to-dataset", validateBody(toDatasetSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof toDatasetSchema>;
  const results = await getResultsWithHtml(body.jobId);

  if (results.length === 0) {
    return c.json({ error: "No results found" }, 404);
  }

  const withHtml = results.filter((r: any) => r.rawHtml);
  if (withHtml.length === 0) {
    return c.json({
      error: "No results have raw HTML stored. Re-scrape to capture HTML."
    }, 400);
  }

  const rows: Record<string, unknown>[] = [];

  for (const r of withHtml) {
    try {
      const data = runExtraction(r.rawHtml!, body.mode, body.config);
      if (Array.isArray(data)) {
        // List mode: each item becomes its own row
        for (const item of data) {
          rows.push({ url: r.url, ...item });
        }
      } else {
        rows.push({ url: r.url, ...data });
      }
    } catch {
      // Skip failed extractions
    }
  }

  if (rows.length === 0) {
    return c.json({ error: "Extraction produced no results" }, 400);
  }

  // Infer schema from first row
  const schema = Object.fromEntries(
    Object.entries(rows[0]).map(([k, v]) => [k, typeof v])
  );

  const [dataset] = await db.insert(datasets).values({
    name: body.datasetName,
    sourceJobId: body.jobId,
    schema,
    rowCount: rows.length,
    extractionConfig: { mode: body.mode, config: body.config }
  }).returning();

  // Insert rows in batches
  const rowValues = rows.map((data, i) => ({
    datasetId: dataset.id,
    data,
    rowIndex: i
  }));

  for (let i = 0; i < rowValues.length; i += 500) {
    await db.insert(datasetRows).values(rowValues.slice(i, i + 500));
  }

  // Spawn per-dataset Docker DB async (fire-and-forget)
  spawnDatasetDatabaseAsync(dataset.id, body.datasetName, Object.keys(schema), rows);

  return c.json({ datasetId: dataset.id, rowCount: rows.length }, 201);
});

// Extract single result + save as 1-row dataset
app.post("/single-to-dataset", validateBody(singleToDatasetSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof singleToDatasetSchema>;
  const results = await getResultsWithHtml(body.jobId, body.resultId);

  if (results.length === 0) {
    return c.json({ error: "Result not found" }, 404);
  }

  const result = results[0];
  if (!result.rawHtml) {
    return c.json({ error: "Raw HTML not available for this result." }, 400);
  }

  let data: any;
  try {
    data = runExtraction(result.rawHtml, body.mode, body.config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Extraction failed: ${msg}` }, 400);
  }

  // List mode returns an array → multiple rows; other modes → single row
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? data.map((item: any) => ({ url: result.url, ...item }))
    : [{ url: result.url, ...data }];

  if (rows.length === 0) {
    return c.json({ error: "Extraction produced no results. Check your wrapper selector." }, 400);
  }

  const schema = Object.fromEntries(
    Object.entries(rows[0]).map(([k, v]) => [k, typeof v])
  );

  const [dataset] = await db.insert(datasets).values({
    name: body.datasetName,
    sourceJobId: body.jobId,
    schema,
    rowCount: rows.length,
    extractionConfig: { mode: body.mode, config: body.config }
  }).returning();

  const rowValues = rows.map((rowData, i) => ({
    datasetId: dataset.id,
    data: rowData,
    rowIndex: i
  }));

  for (let i = 0; i < rowValues.length; i += 500) {
    await db.insert(datasetRows).values(rowValues.slice(i, i + 500));
  }

  // Spawn per-dataset Docker DB async (fire-and-forget)
  spawnDatasetDatabaseAsync(dataset.id, body.datasetName, Object.keys(schema), rows);

  return c.json({ datasetId: dataset.id, rowCount: rows.length }, 201);
});

// ============================================================
// Dataset Builder — interactive source → columns → filters → save
// ============================================================

type TransformConfig = {
  type: "none" | "split" | "regex" | "prefix" | "template";
  delimiter?: string;
  index?: number;
  pattern?: string;
  prefix?: string;
  template?: string;
};

type FilterConfig = {
  field: string;
  operator: "contains" | "not_contains" | "matches" | "not_matches" | "equals" | "not_equals" | "starts_with" | "ends_with";
  value: string;
};

type ColumnConfig = {
  sourceField: string;
  outputName: string;
  transform?: TransformConfig;
};

/**
 * Normalize auto-parsed data into uniform arrays of objects.
 * headings {h1:[],h2:[]} → [{level,text}], emails/phones [] → [{value}], tables → [{col:val}]
 */
function normalizeSource(autoparseData: any, key: string, tableIndex?: number): Record<string, unknown>[] {
  const data = autoparseData?.[key];
  if (!data) return [];

  // Scalar arrays: emails, phones, hashtags
  if (["emails", "phones", "hashtags"].includes(key)) {
    return Array.isArray(data) ? data.map((v: string) => ({ value: v })) : [];
  }

  // Headings: {h1:[], h2:[], ...} → [{level, text}]
  if (key === "headings" && typeof data === "object" && !Array.isArray(data)) {
    const items: Record<string, unknown>[] = [];
    for (const [level, texts] of Object.entries(data)) {
      if (Array.isArray(texts)) {
        for (const text of texts) items.push({ level, text: String(text) });
      }
    }
    return items;
  }

  // Tables: extract a specific table and flatten rows using headers
  if (key === "tables" && Array.isArray(data)) {
    const table = data[tableIndex ?? 0];
    if (!table?.rows) return [];
    const headers = table.headers?.length > 0
      ? table.headers
      : table.rows[0]?.map((_: any, i: number) => `col_${i}`) || [];
    return table.rows.map((row: any[]) =>
      Object.fromEntries(headers.map((h: string, i: number) => [h, row[i] ?? null]))
    );
  }

  // Menus: [[{text,href}], ...] → [{menuIndex, text, href}]
  if (key === "menus" && Array.isArray(data)) {
    const items: Record<string, unknown>[] = [];
    data.forEach((menu: any[], idx: number) => {
      if (Array.isArray(menu)) {
        for (const item of menu) items.push({ menuIndex: idx, ...item });
      }
    });
    return items;
  }

  // Metadata: single object → [object]
  if (key === "metadata" && typeof data === "object" && !Array.isArray(data)) {
    return [data];
  }

  // Default: links, images, videos — already arrays of objects
  return Array.isArray(data) ? data : [];
}

function applyTransform(value: unknown, transform: TransformConfig | undefined): unknown {
  if (!transform || transform.type === "none") return value;
  const str = value == null ? "" : String(value);

  switch (transform.type) {
    case "split": {
      const rawDelim = transform.delimiter || "\n";
      const delim = rawDelim.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      const parts = str.split(delim).map(p => p.trim()).filter(p => p);
      return transform.index != null ? (parts[transform.index] ?? "") : parts.join(", ");
    }
    case "regex": {
      if (!transform.pattern) return str;
      try {
        const match = str.match(new RegExp(transform.pattern.slice(0, 200)));
        return match?.[1] ?? match?.[0] ?? "";
      } catch {
        return str;
      }
    }
    case "prefix":
      return (transform.prefix || "") + str;
    case "template":
      return (transform.template || "{value}").replace(/\{value\}/g, str);
    default:
      return value;
  }
}

function applyFilter(row: Record<string, unknown>, filter: FilterConfig): boolean {
  const val = String(row[filter.field] ?? "");
  const target = filter.value;

  switch (filter.operator) {
    case "contains": return val.includes(target);
    case "not_contains": return !val.includes(target);
    case "equals": return val === target;
    case "not_equals": return val !== target;
    case "starts_with": return val.startsWith(target);
    case "ends_with": return val.endsWith(target);
    case "matches":
      try { return new RegExp(target.slice(0, 200)).test(val); }
      catch { return false; }
    case "not_matches":
      try { return !new RegExp(target.slice(0, 200)).test(val); }
      catch { return true; }
    default: return true;
  }
}

function shapeRows(
  sourceItems: Record<string, unknown>[],
  columns: ColumnConfig[],
  filters: FilterConfig[]
): { rows: Record<string, unknown>[]; totalAvailable: number; totalAfterFilter: number } {
  const totalAvailable = sourceItems.length;

  // Apply filters first
  let filtered = sourceItems;
  for (const f of filters) {
    filtered = filtered.filter(item => applyFilter(item, f));
  }
  const totalAfterFilter = filtered.length;

  // Apply column mapping + transforms
  const rows = filtered.map(item => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      out[col.outputName] = applyTransform(item[col.sourceField], col.transform);
    }
    return out;
  });

  return { rows, totalAvailable, totalAfterFilter };
}

// --- Builder Schemas ---

const buildSourcesSchema = z.object({
  jobId: z.number().int(),
  resultId: z.number().int().optional()
});

const buildPreviewSchema = z.object({
  jobId: z.number().int(),
  resultId: z.number().int().optional(),
  source: z.object({
    key: z.string(),
    tableIndex: z.number().int().optional()
  }),
  columns: z.array(z.object({
    sourceField: z.string(),
    outputName: z.string().min(1).max(100),
    transform: z.object({
      type: z.enum(["none", "split", "regex", "prefix", "template"]),
      delimiter: z.string().optional(),
      index: z.number().int().optional(),
      pattern: z.string().max(200).optional(),
      prefix: z.string().optional(),
      template: z.string().optional()
    }).optional()
  })).min(1),
  filters: z.array(z.object({
    field: z.string(),
    operator: z.enum(["contains", "not_contains", "matches", "not_matches", "equals", "not_equals", "starts_with", "ends_with"]),
    value: z.string()
  })).optional()
});

const buildToDatasetSchema = buildPreviewSchema.extend({
  datasetName: z.string().min(1).max(200),
  description: z.string().max(1000).optional()
});

// --- Builder Routes ---

// Get available data sources from a scrape result
app.post("/build-sources", validateBody(buildSourcesSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof buildSourcesSchema>;
  const results = await getResultsWithHtml(body.jobId, body.resultId);

  if (results.length === 0) return c.json({ error: "No results found" }, 404);

  const result = results[0];
  let autoData = result.autoparseData;

  // If no autoparse data but rawHtml available, parse it
  if (!autoData && result.rawHtml) {
    try {
      const parser = loadAutoParser();
      autoData = parser.parse(result.rawHtml, [
        "headings", "links", "images", "tables", "metadata",
        "emails", "phones", "videos", "audios", "menus",
        "hashtags", "favicons"
      ]);
    } catch {
      return c.json({ error: "Failed to parse HTML" }, 500);
    }
  }

  if (!autoData) {
    return c.json({ error: "No parsed data available. Raw HTML may not have been captured." }, 400);
  }

  const sourceKeys = ["links", "images", "tables", "headings", "metadata", "emails", "phones", "videos", "menus", "hashtags"];
  const sources: any[] = [];

  for (const key of sourceKeys) {
    const raw = autoData[key];
    if (!raw) continue;

    if (key === "tables" && Array.isArray(raw)) {
      // Each table is a separate sub-source
      raw.forEach((table: any, idx: number) => {
        const headers = table.headers || [];
        const rowCount = table.rows?.length || 0;
        if (rowCount === 0) return;
        sources.push({
          key: "tables",
          tableIndex: idx,
          count: rowCount,
          sampleFields: headers.length > 0 ? headers : [`col_0`],
          sample: normalizeSource(autoData, "tables", idx)[0] || null,
          label: `Table ${idx}: ${headers.join(", ")} (${rowCount} rows)`
        });
      });
      continue;
    }

    const normalized = normalizeSource(autoData, key);
    if (normalized.length === 0) continue;

    sources.push({
      key,
      count: normalized.length,
      sampleFields: Object.keys(normalized[0]),
      sample: normalized[0],
      label: `${key} (${normalized.length} items)`
    });
  }

  return c.json({
    sources,
    resultUrl: result.url,
    resultCount: results.length
  });
});

// Preview shaped rows
app.post("/build-preview", validateBody(buildPreviewSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof buildPreviewSchema>;
  const results = await getResultsWithHtml(body.jobId, body.resultId);

  if (results.length === 0) return c.json({ error: "No results found" }, 404);

  const result = results[0];
  let autoData = result.autoparseData;

  if (!autoData && result.rawHtml) {
    try {
      const parser = loadAutoParser();
      autoData = parser.parse(result.rawHtml, [
        "headings", "links", "images", "tables", "metadata",
        "emails", "phones", "videos", "audios", "menus",
        "hashtags", "favicons"
      ]);
    } catch {
      return c.json({ error: "Failed to parse HTML" }, 500);
    }
  }

  if (!autoData) return c.json({ error: "No data available" }, 400);

  const sourceItems = normalizeSource(autoData, body.source.key, body.source.tableIndex);
  const { rows, totalAvailable, totalAfterFilter } = shapeRows(
    sourceItems,
    body.columns as ColumnConfig[],
    (body.filters || []) as FilterConfig[]
  );

  return c.json({
    rows: rows.slice(0, 20),
    totalAvailable,
    totalAfterFilter,
    previewCount: Math.min(rows.length, 20)
  });
});

// Build + save as dataset
app.post("/build-to-dataset", validateBody(buildToDatasetSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof buildToDatasetSchema>;
  const results = await getResultsWithHtml(body.jobId, body.resultId);

  if (results.length === 0) return c.json({ error: "No results found" }, 404);

  const result = results[0];
  let autoData = result.autoparseData;

  if (!autoData && result.rawHtml) {
    try {
      const parser = loadAutoParser();
      autoData = parser.parse(result.rawHtml, [
        "headings", "links", "images", "tables", "metadata",
        "emails", "phones", "videos", "audios", "menus",
        "hashtags", "favicons"
      ]);
    } catch {
      return c.json({ error: "Failed to parse HTML" }, 500);
    }
  }

  if (!autoData) return c.json({ error: "No data available" }, 400);

  const sourceItems = normalizeSource(autoData, body.source.key, body.source.tableIndex);
  const { rows, totalAfterFilter } = shapeRows(
    sourceItems,
    body.columns as ColumnConfig[],
    (body.filters || []) as FilterConfig[]
  );

  if (rows.length === 0) {
    return c.json({ error: "No rows after applying filters. Adjust your configuration." }, 400);
  }

  const schema = Object.fromEntries(
    Object.entries(rows[0]).map(([k, v]) => [k, typeof v])
  );

  const [dataset] = await db.insert(datasets).values({
    name: body.datasetName,
    description: body.description || null,
    sourceJobId: body.jobId,
    schema,
    rowCount: rows.length
  }).returning();

  const rowValues = rows.map((data, i) => ({
    datasetId: dataset.id,
    data,
    rowIndex: i
  }));

  for (let i = 0; i < rowValues.length; i += 500) {
    await db.insert(datasetRows).values(rowValues.slice(i, i + 500));
  }

  // Spawn per-dataset Docker DB async (fire-and-forget)
  spawnDatasetDatabaseAsync(dataset.id, body.datasetName, Object.keys(schema), rows);

  return c.json({ datasetId: dataset.id, rowCount: rows.length }, 201);
});

// ── Autoparse category → Dataset (quick-create from structured viewer) ──

const autoparseToDsSchema = z.object({
  jobId: z.number().int(),
  resultId: z.number().int(),
  category: z.enum(["links", "images", "tables", "headings", "emails", "phones", "videos", "audios", "menus", "hashtags", "favicons", "metadata"]),
  tableIndex: z.number().int().optional(),
  datasetName: z.string().min(1).max(200)
});

app.post("/autoparse-to-dataset", validateBody(autoparseToDsSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof autoparseToDsSchema>;

  const results = await getResultsWithHtml(body.jobId, body.resultId);
  if (results.length === 0) return c.json({ error: "Result not found" }, 404);

  const result = results[0];
  let autoData = result.autoparseData;

  // If no autoparse data but rawHtml available, parse it
  if (!autoData && result.rawHtml) {
    try {
      const parser = loadAutoParser();
      autoData = parser.parse(result.rawHtml, [
        "headings", "links", "images", "tables", "metadata",
        "emails", "phones", "videos", "audios", "menus",
        "hashtags", "favicons"
      ]);
    } catch {
      return c.json({ error: "Failed to parse HTML" }, 500);
    }
  }

  if (!autoData) {
    return c.json({ error: "No parsed data available" }, 400);
  }

  const rows = normalizeSource(autoData, body.category, body.tableIndex);
  if (rows.length === 0) {
    return c.json({ error: `No ${body.category} data found in this result` }, 400);
  }

  const schema = Object.fromEntries(
    Object.entries(rows[0]).map(([k, v]) => [k, typeof v])
  );

  const [dataset] = await db.insert(datasets).values({
    name: body.datasetName,
    sourceJobId: body.jobId,
    schema,
    rowCount: rows.length
  }).returning();

  const rowValues = rows.map((data, i) => ({
    datasetId: dataset.id,
    data,
    rowIndex: i
  }));

  for (let i = 0; i < rowValues.length; i += 500) {
    await db.insert(datasetRows).values(rowValues.slice(i, i + 500));
  }

  // Spawn per-dataset Docker DB async
  spawnDatasetDatabaseAsync(dataset.id, body.datasetName, Object.keys(schema), rows);

  return c.json({ datasetId: dataset.id, rowCount: rows.length }, 201);
});

// ── Auto-detect content type ──────────────────────────────────────────

const autoDetectSchema = z.object({
  jobId: z.number().int().positive(),
  resultId: z.number().int().positive().optional()
});

app.post("/auto-detect", validateBody(autoDetectSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof autoDetectSchema>;

  const results = await getResultsWithHtml(body.jobId, body.resultId);
  const withHtml = results.filter((r: any) => r.rawHtml);
  if (withHtml.length === 0) {
    return c.json({ error: "No results with HTML content found" }, 400);
  }

  // Use the first result's HTML for detection
  const html = withHtml[0].rawHtml!;

  try {
    const { detectContentType } = loadSemanticParser();
    const detection = detectContentType(html, loadCheerio);
    return c.json(detection);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Auto-detection failed: ${msg}` }, 500);
  }
});

export default app;
