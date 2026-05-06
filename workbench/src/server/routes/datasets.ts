import { Hono } from "hono";
import { z } from "zod";
import { createRequire } from "node:module";
import path from "node:path";
import { db } from "../lib/db.js";
import { datasets, datasetRows, scrapeResults, scrapeJobs } from "../../db/schema.js";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import {
  connectionUrl,
  spawnDatasetDatabase,
  destroyDatasetDatabase,
  exportDatasetDatabase,
  loadRegistry,
  getContainerStatus
} from "../lib/docker-manager.js";
import { validateBody, type Env } from "../middleware/validate.js";

const require = createRequire(import.meta.url);
const SCRAPEKIT_ROOT = path.resolve(import.meta.dirname, "../../../../");

function loadAutoParser() {
  const AutoParser = require(path.join(SCRAPEKIT_ROOT, "lib/extractors/auto-parser"));
  return new AutoParser();
}
function loadResponseConverter() {
  const ResponseConverter = require(path.join(SCRAPEKIT_ROOT, "lib/core/response-converter"));
  return new ResponseConverter();
}

// CSV helpers
function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(h => escapeCsvCell(h)).join(","),
    ...rows.map(row => headers.map(h => escapeCsvCell(row[h])).join(","))
  ];
  return lines.join("\n");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_").slice(0, 100) || "dataset";
}

const app = new Hono<Env>();

const createDatasetSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  sourceJobId: z.number().int().optional(),
  rows: z.array(z.record(z.unknown())).optional()
});

const updateDatasetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional()
});

// List datasets
app.get("/", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const result = await db.select()
    .from(datasets)
    .orderBy(desc(datasets.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ datasets: result, limit, offset });
});

// Create dataset
app.post("/", validateBody(createDatasetSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof createDatasetSchema>;

  let rows: Record<string, unknown>[] = body.rows || [];

  // If sourceJobId, populate from scrape results
  if (body.sourceJobId && rows.length === 0) {
    const results = await db.select().from(scrapeResults)
      .where(eq(scrapeResults.jobId, body.sourceJobId));

    // Auto-extract structured data from raw HTML when available
    const withHtml = results.filter((r: any) => r.rawHtml);

    if (withHtml.length > 0) {
      const parser = loadAutoParser();
      const converter = loadResponseConverter();
      rows = results.map((r: any) => {
        if (!r.rawHtml) {
          return { url: r.url, status: r.status, timing: r.timing, error: r.error };
        }

        try {
          const parsed = parser.parse(r.rawHtml, ["headings", "links", "images", "tables", "metadata"]);
          let markdown = "";
          try { markdown = converter.convert(r.rawHtml, "markdown"); } catch { /* skip */ }
          const urlPath = new URL(r.url).pathname;
          const pathParts = urlPath.split("/").filter(Boolean);
          const section = pathParts.slice(0, 2).join("/") || "/";
          // Flatten headings from {h1: [...], h2: [...]} to array of strings
          const allHeadings: string[] = [];
          if (parsed.headings && typeof parsed.headings === "object") {
            for (const vals of Object.values(parsed.headings)) {
              if (Array.isArray(vals)) allHeadings.push(...vals.map((v: any) => String(v)));
            }
          }

          return {
            url: r.url,
            title: parsed.metadata?.title || allHeadings[0] || "",
            description: parsed.metadata?.description || "",
            section,
            content: markdown,
            word_count: markdown.split(/\s+/).filter(Boolean).length,
            heading_count: allHeadings.length,
            link_count: (parsed.links || []).length,
            image_count: (parsed.images || []).length,
            table_count: (parsed.tables || []).length,
            headings: allHeadings,
            status: r.status,
            timing: r.timing,
            error: r.error
          };
        } catch {
          return { url: r.url, status: r.status, timing: r.timing, error: r.error };
        }
      });
    } else {
      // No rawHtml available — use whatever extracted/autoparsed data exists
      rows = results.map((r: any) => ({
        url: r.url,
        status: r.status,
        timing: r.timing,
        ...(r.extractedData as Record<string, unknown> || {}),
        ...(r.autoparseData as Record<string, unknown> || {}),
        error: r.error
      }));
    }
  }

  // Infer schema from first row
  const schema = rows.length > 0
    ? Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, typeof v]))
    : {};

  const [dataset] = await db.insert(datasets).values({
    name: body.name,
    description: body.description || null,
    sourceJobId: body.sourceJobId || null,
    schema,
    rowCount: rows.length
  }).returning();

  // Insert rows
  if (rows.length > 0) {
    const rowValues = rows.map((data, i) => ({
      datasetId: dataset.id,
      data,
      rowIndex: i
    }));

    // Batch insert in chunks of 500
    for (let i = 0; i < rowValues.length; i += 500) {
      await db.insert(datasetRows).values(rowValues.slice(i, i + 500));
    }
  }

  return c.json(dataset, 201);
});

// Get dataset metadata (with database info)
app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!dataset) return c.json({ error: "Not found" }, 404);

  // Include database connection info if available
  let databaseInfo: { port: number; connectionUrl: string; status: string } | null = null;
  if (dataset.databasePort && dataset.databaseContainerId) {
    const status = await getContainerStatus(dataset.databaseContainerId);
    const registryEntry = loadRegistry().find(e => e.containerId === dataset.databaseContainerId);
    const entryPassword = registryEntry?.password;
    databaseInfo = {
      port: dataset.databasePort,
      connectionUrl: connectionUrl(dataset.databasePort, entryPassword),
      status
    };
  }

  return c.json({ ...dataset, databaseInfo });
});

// Get dataset rows (paginated, with search)
app.get("/:id/rows", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 500);
  const offset = parseInt(c.req.query("offset") || "0");
  const sortDir = c.req.query("dir") === "desc" ? "desc" : "asc";
  const search = c.req.query("search")?.trim();

  const whereClause = search
    ? sql`${datasetRows.datasetId} = ${id} AND ${datasetRows.data}::text ILIKE ${"%" + search + "%"}`
    : eq(datasetRows.datasetId, id);

  const [{ count: totalFiltered }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(datasetRows)
    .where(whereClause);

  const rows = await db.select()
    .from(datasetRows)
    .where(whereClause)
    .orderBy(sortDir === "asc" ? asc(datasetRows.rowIndex) : desc(datasetRows.rowIndex))
    .limit(limit)
    .offset(offset);

  return c.json({ rows: rows.map(r => r.data), totalFiltered, limit, offset });
});

// Export dataset as CSV, JSON, or JSONL
app.get("/:id/export", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const format = c.req.query("format") || "json";
  if (!["csv", "json", "jsonl"].includes(format)) {
    return c.json({ error: "Invalid format. Use csv, json, or jsonl" }, 400);
  }

  const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!dataset) return c.json({ error: "Not found" }, 404);

  // Fetch ALL rows
  const allRows = await db.select()
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, id))
    .orderBy(asc(datasetRows.rowIndex));

  const rows = allRows.map(r => r.data as Record<string, unknown>);

  if (format === "csv") {
    const csvContent = rowsToCsv(rows);
    c.header("Content-Disposition", `attachment; filename="${sanitizeFilename(dataset.name)}.csv"`);
    c.header("Content-Type", "text/csv; charset=utf-8");
    return c.body(csvContent);
  }

  if (format === "jsonl") {
    const lines = rows.map(r => JSON.stringify(r)).join("\n");
    c.header("Content-Disposition", `attachment; filename="${sanitizeFilename(dataset.name)}.jsonl"`);
    c.header("Content-Type", "application/x-ndjson; charset=utf-8");
    return c.body(lines);
  }

  // JSON (default)
  const payload = { dataset: { id: dataset.id, name: dataset.name, description: dataset.description, rowCount: dataset.rowCount }, rows };
  c.header("Content-Disposition", `attachment; filename="${sanitizeFilename(dataset.name)}.json"`);
  c.header("Content-Type", "application/json; charset=utf-8");
  return c.body(JSON.stringify(payload, null, 2));
});

// Integration code snippets
app.get("/:id/snippet", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const lang = c.req.query("lang") || "curl";
  const host = c.req.header("host") || "localhost:3003";
  const baseUrl = `http://${host}/api`;

  let code: string;
  switch (lang) {
    case "python":
      code = [
        "import requests",
        "",
        `BASE_URL = "${baseUrl}"`,
        "",
        "# Get dataset metadata",
        `dataset = requests.get(f"{BASE_URL}/datasets/${id}").json()`,
        `print(f"Dataset: {dataset['name']} ({dataset['rowCount']} rows)")`,
        "",
        "# Fetch all rows (paginated)",
        "rows = []",
        "offset = 0",
        "while True:",
        `    page = requests.get(f"{BASE_URL}/datasets/${id}/rows", params={"limit": 500, "offset": offset}).json()`,
        `    rows.extend(page["rows"])`,
        `    if len(page["rows"]) < 500:`,
        "        break",
        "    offset += 500",
        "",
        `print(f"Fetched {len(rows)} rows")`,
        "# rows[0].keys() to see available columns",
      ].join("\n");
      break;

    case "node":
      code = [
        `const BASE_URL = "${baseUrl}";`,
        "",
        "async function fetchDataset() {",
        "  // Get metadata",
        `  const meta = await fetch(\`\${BASE_URL}/datasets/${id}\`).then(r => r.json());`,
        "  console.log(`Dataset: ${meta.name} (${meta.rowCount} rows)`);",
        "",
        "  // Fetch all rows",
        "  const rows = [];",
        "  let offset = 0;",
        "  while (true) {",
        `    const page = await fetch(\`\${BASE_URL}/datasets/${id}/rows?limit=500&offset=\${offset}\`).then(r => r.json());`,
        "    rows.push(...page.rows);",
        "    if (page.rows.length < 500) break;",
        "    offset += 500;",
        "  }",
        "",
        "  console.log(`Fetched ${rows.length} rows`);",
        "  return rows;",
        "}",
        "",
        "fetchDataset();",
      ].join("\n");
      break;

    default: // curl
      code = [
        "# Get dataset metadata",
        `curl -s ${baseUrl}/datasets/${id} | jq .`,
        "",
        "# Get first 50 rows",
        `curl -s "${baseUrl}/datasets/${id}/rows?limit=50" | jq .`,
        "",
        "# Search rows",
        `curl -s "${baseUrl}/datasets/${id}/rows?search=keyword" | jq .`,
        "",
        "# Export as CSV",
        `curl -s "${baseUrl}/datasets/${id}/export?format=csv" -o dataset_${id}.csv`,
        "",
        "# Export as JSON",
        `curl -s "${baseUrl}/datasets/${id}/export?format=json" -o dataset_${id}.json`,
        "",
        "# Export as JSONL (LLM-ready)",
        `curl -s "${baseUrl}/datasets/${id}/export?format=jsonl" -o dataset_${id}.jsonl`,
      ].join("\n");
      break;
  }

  return c.json({ code, lang });
});

// Update dataset metadata
app.put("/:id", validateBody(updateDatasetSchema), async (c) => {
  const id = parseInt(c.req.param("id")!);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const body = c.get("validatedBody") as z.infer<typeof updateDatasetSchema>;

  const [updated] = await db.update(datasets)
    .set(body)
    .where(eq(datasets.id, id))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// Delete dataset (cascade deletes rows + destroy Docker container)
app.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  // Check for Docker container to destroy
  const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!dataset) return c.json({ error: "Not found" }, 404);

  if (dataset.databaseContainerId) {
    try {
      await destroyDatasetDatabase(dataset.databaseContainerId);
    } catch {
      // Container may already be gone
    }
  }

  const [deleted] = await db.delete(datasets)
    .where(eq(datasets.id, id))
    .returning({ id: datasets.id });

  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ deleted: true, id: deleted.id });
});

// ============================================================
// Dataset Database Management
// ============================================================

// Spawn a Docker database for an existing dataset
app.post("/:id/database/spawn", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!dataset) return c.json({ error: "Not found" }, 404);

  if (dataset.databaseStatus === "running" && dataset.databaseContainerId) {
    return c.json({ error: "Database already running", port: dataset.databasePort }, 409);
  }

  // Fetch all rows for this dataset
  const allRows = await db.select()
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, id))
    .orderBy(asc(datasetRows.rowIndex));

  const rows = allRows.map(r => r.data as Record<string, unknown>);
  const schemaColumns = dataset.schema ? Object.keys(dataset.schema) : (rows.length > 0 ? Object.keys(rows[0]) : []);

  await db.update(datasets)
    .set({ databaseStatus: "creating" })
    .where(eq(datasets.id, id));

  try {
    const spawn = await spawnDatasetDatabase(id, dataset.name, schemaColumns, rows);

    await db.update(datasets)
      .set({
        databasePort: spawn.port,
        databaseContainerId: spawn.containerId,
        databaseStatus: "running"
      })
      .where(eq(datasets.id, id));

    return c.json({
      spawned: true,
      port: spawn.port,
      connectionUrl: connectionUrl(spawn.port, spawn.password)
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(datasets)
      .set({ databaseStatus: "error" })
      .where(eq(datasets.id, id));

    return c.json({ error: `Failed to spawn database: ${msg}` }, 500);
  }
});

// Export dataset's Docker database
app.post("/:id/database/export", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!dataset) return c.json({ error: "Not found" }, 404);

  if (!dataset.databaseContainerId) {
    return c.json({ error: "This dataset has no Docker database" }, 400);
  }

  const registry = loadRegistry();
  const entry = registry.find(d => d.containerId === dataset.databaseContainerId);
  const slug = entry?.id || `dataset-${id}`;

  try {
    const result = await exportDatasetDatabase(dataset.databaseContainerId, slug);
    return c.json({
      exported: true,
      dir: result.dir,
      dumpPath: result.dumpPath,
      dockerfilePath: result.dockerfilePath,
      composePath: result.composePath,
      sizeHuman: `${(result.size / 1024).toFixed(1)} KB`,
      size: result.size
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Export failed: ${msg}` }, 500);
  }
});

// Destroy dataset's Docker database
app.delete("/:id/database", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!dataset) return c.json({ error: "Not found" }, 404);

  if (!dataset.databaseContainerId) {
    return c.json({ error: "This dataset has no Docker database" }, 400);
  }

  try {
    await destroyDatasetDatabase(dataset.databaseContainerId);
    await db.update(datasets)
      .set({ databasePort: null, databaseContainerId: null, databaseStatus: "none" })
      .where(eq(datasets.id, id));

    return c.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to destroy database: ${msg}` }, 500);
  }
});

export default app;
