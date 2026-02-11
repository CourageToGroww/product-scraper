import { db } from "./db.js";
import { scrapeJobs, scrapeResults } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { aiParseJobResults, getAiSettings } from "./ai-parser.js";

const DEFAULT_HEADERS: Record<string, string> = {
  "Accept": "*/*",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

// ── URL Pattern Expansion ────────────────────────────────────────────

/**
 * Expand URL patterns like [1-50] into individual URLs.
 * Examples:
 *   https://api.example.com/items?page=[1-50]  → 50 URLs
 *   https://api.example.com/items/[100-200]    → 101 URLs
 *   https://api.example.com/items              → 1 URL (no pattern)
 */
export function expandUrlPattern(pattern: string): string[] {
  const match = pattern.match(/\[(\d+)-(\d+)\]/);
  if (!match) return [pattern];

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  if (isNaN(start) || isNaN(end) || start > end) return [pattern];

  const count = Math.min(end - start + 1, 5000);
  const urls: string[] = [];
  for (let i = start; i < start + count; i++) {
    urls.push(pattern.replace(match[0], String(i)));
  }
  return urls;
}

// ── Response Type Detection ──────────────────────────────────────────

type DetectedType = "json" | "xml" | "csv" | "text" | "html";

export function detectResponseType(contentType: string, body: string): DetectedType {
  const ct = contentType.toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) return "xml";
  if (ct.includes("csv") || ct.includes("tab-separated")) return "csv";
  if (ct.includes("html")) return "html";
  if (ct.includes("text/plain")) return "text";

  // Sniff from content if content-type is ambiguous
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<rss") || trimmed.startsWith("<feed")) return "xml";
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return "html";

  return "text";
}

/**
 * Quick-detect whether a URL returns API data or a web page.
 * Single fetch with 10s timeout, checks Content-Type + body sniffing.
 */
export async function quickDetectUrlType(
  url: string,
  headers?: Record<string, string>
): Promise<{ type: "api" | "web"; detectedFormat: DetectedType }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...headers },
      signal: controller.signal,
      redirect: "follow"
    });
    clearTimeout(timer);
    const ct = res.headers.get("content-type") || "";
    // Read only first 4KB for sniffing — no need to download full page
    const reader = res.body?.getReader();
    let body = "";
    if (reader) {
      const { value } = await reader.read();
      body = value ? new TextDecoder().decode(value) : "";
      reader.cancel().catch(() => {});
    }
    const format = detectResponseType(ct, body);
    return {
      type: (format === "json" || format === "xml" || format === "csv") ? "api" : "web",
      detectedFormat: format
    };
  } catch {
    clearTimeout(timer);
    // If fetch fails, default to web scrape (browser might handle it better)
    return { type: "web", detectedFormat: "html" };
  }
}

// ── CSV Parser ───────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

// ── XML → JSON (simple) ─────────────────────────────────────────────

function xmlToSimpleJson(xml: string): Record<string, unknown> {
  // Extract all top-level items from RSS/Atom or generic XML
  // This is intentionally simple — for complex XML, users can work with rawHtml
  const items: Record<string, string>[] = [];

  // Try RSS items
  const rssItems = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi);
  if (rssItems) {
    for (const item of rssItems) {
      const row: Record<string, string> = {};
      const tags = item.match(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/g);
      if (tags) {
        for (const tag of tags) {
          const m = tag.match(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/);
          if (m) row[m[1]] = m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
        }
      }
      items.push(row);
    }
    return { _type: "rss", items, count: items.length };
  }

  // Try Atom entries
  const atomEntries = xml.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi);
  if (atomEntries) {
    for (const entry of atomEntries) {
      const row: Record<string, string> = {};
      const tags = entry.match(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/g);
      if (tags) {
        for (const tag of tags) {
          const m = tag.match(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/);
          if (m) row[m[1]] = m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
        }
      }
      // Extract link href
      const linkMatch = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/);
      if (linkMatch) row.link = linkMatch[1];
      items.push(row);
    }
    return { _type: "atom", items, count: items.length };
  }

  // Generic: just return raw text marker
  return { _type: "xml", _raw: true };
}

// ── Auto-detect Pagination ───────────────────────────────────────────

const PAGINATION_COUNT_KEYS = ["count", "total", "total_count", "totalCount", "total_results", "totalResults", "total_items", "totalItems"];
const PAGINATION_ITEMS_KEYS = ["items", "data", "results", "records", "entries", "products", "rows", "list", "hits", "documents", "objects", "nodes"];

export interface PaginationDetection {
  detected: boolean;
  totalItems?: number;
  itemsKey?: string;
  itemsPerPage?: number;
  totalPages?: number;
  pageParam?: string;
  suggestedPattern?: string;
  sample?: unknown;
  responseType: DetectedType;
  responseKeys?: string[];
}

export async function detectApiPagination(
  url: string,
  customHeaders?: Record<string, string>
): Promise<PaginationDetection> {
  const headers = { ...DEFAULT_HEADERS, ...customHeaders };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);

    const contentType = res.headers.get("content-type") || "";
    const body = await res.text();
    const responseType = detectResponseType(contentType, body);

    if (responseType === "json") {
      try {
        const data = JSON.parse(body);
        if (typeof data !== "object" || data === null) {
          return { detected: false, responseType };
        }

        const keys = Object.keys(data);
        let totalItems: number | undefined;
        let itemsKey: string | undefined;
        let itemsPerPage: number | undefined;

        // Find total count
        for (const k of PAGINATION_COUNT_KEYS) {
          if (typeof data[k] === "number" && data[k] > 0) {
            totalItems = data[k];
            break;
          }
        }

        // Find items array
        for (const k of PAGINATION_ITEMS_KEYS) {
          if (Array.isArray(data[k]) && data[k].length > 0) {
            itemsKey = k;
            itemsPerPage = data[k].length;
            break;
          }
        }

        // If no common key found, check all keys for arrays
        if (!itemsKey) {
          for (const k of keys) {
            if (Array.isArray(data[k]) && data[k].length > 0) {
              itemsKey = k;
              itemsPerPage = data[k].length;
              break;
            }
          }
        }

        // Detect page parameter from URL
        const urlObj = new URL(url);
        let pageParam: string | undefined;
        for (const [key, val] of urlObj.searchParams) {
          if (/^(page|p|offset|skip|start|cursor|from)$/i.test(key)) {
            pageParam = key;
            break;
          }
        }

        // Calculate pagination
        let totalPages: number | undefined;
        let suggestedPattern: string | undefined;
        if (totalItems && itemsPerPage && pageParam) {
          totalPages = Math.ceil(totalItems / itemsPerPage);
          // Build pattern: replace the page param value with [1-N]
          const patternUrl = new URL(url);
          patternUrl.searchParams.set(pageParam, `[1-${totalPages}]`);
          suggestedPattern = decodeURIComponent(patternUrl.toString());
        }

        return {
          detected: !!(totalItems && itemsKey),
          totalItems,
          itemsKey,
          itemsPerPage,
          totalPages,
          pageParam,
          suggestedPattern,
          sample: itemsKey ? data[itemsKey]?.[0] : undefined,
          responseType,
          responseKeys: keys
        };
      } catch {
        return { detected: false, responseType };
      }
    }

    if (responseType === "csv") {
      const rows = parseCsv(body);
      return {
        detected: false,
        totalItems: rows.length,
        itemsKey: "_csv_rows",
        itemsPerPage: rows.length,
        sample: rows[0],
        responseType,
        responseKeys: rows[0] ? Object.keys(rows[0]) : []
      };
    }

    if (responseType === "xml") {
      const parsed = xmlToSimpleJson(body);
      const items = (parsed as { items?: unknown[] }).items;
      return {
        detected: false,
        totalItems: items?.length,
        itemsKey: "items",
        sample: items?.[0],
        responseType,
        responseKeys: Object.keys(parsed)
      };
    }

    return { detected: false, responseType };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Process Response ─────────────────────────────────────────────────

function processResponse(
  body: string,
  responseType: DetectedType
): { extractedData: Record<string, unknown> | null; rawHtml: string | null; responseTypeName: string } {
  switch (responseType) {
    case "json": {
      try {
        return { extractedData: JSON.parse(body), rawHtml: null, responseTypeName: "json" };
      } catch {
        return { extractedData: null, rawHtml: body, responseTypeName: "json" };
      }
    }
    case "csv": {
      const rows = parseCsv(body);
      return {
        extractedData: { _type: "csv", rows, count: rows.length } as Record<string, unknown>,
        rawHtml: body,
        responseTypeName: "csv"
      };
    }
    case "xml": {
      const parsed = xmlToSimpleJson(body);
      if ((parsed as { _raw?: boolean })._raw) {
        return { extractedData: null, rawHtml: body, responseTypeName: "xml" };
      }
      return { extractedData: parsed, rawHtml: body, responseTypeName: "xml" };
    }
    default:
      return { extractedData: null, rawHtml: body, responseTypeName: responseType };
  }
}

// ── Main Job Runner ──────────────────────────────────────────────────

interface ApiScrapeConfig {
  urls: string[];
  headers?: Record<string, string>;
  delay?: number;
  timeout?: number;
}

export async function runApiScrapeJob(jobId: number, config: ApiScrapeConfig): Promise<void> {
  const headers = { ...DEFAULT_HEADERS, ...config.headers };
  const delayMs = config.delay ?? 200;
  const timeoutMs = config.timeout ?? 30000;

  const totalUrls = config.urls.length;

  await db.update(scrapeJobs)
    .set({
      status: "running",
      startedAt: new Date(),
      progress: { completed: 0, total: totalUrls, currentUrl: config.urls[0] }
    })
    .where(eq(scrapeJobs.id, jobId));

  try {
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < config.urls.length; i++) {
      const url = config.urls[i];

      if (i % 5 === 0 || i === config.urls.length - 1) {
        await db.update(scrapeJobs)
          .set({ progress: { completed: i, total: totalUrls, currentUrl: url } })
          .where(eq(scrapeJobs.id, jobId))
          .catch(() => {});
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const startTime = Date.now();
        const res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timer);
        const timing = Date.now() - startTime;

        const contentType = res.headers.get("content-type") || "";
        const body = await res.text();
        const responseType = detectResponseType(contentType, body);
        const { extractedData, rawHtml, responseTypeName } = processResponse(body, responseType);

        await db.insert(scrapeResults).values({
          jobId,
          url,
          status: res.status,
          originalStatus: res.status,
          timing,
          responseType: responseTypeName,
          extractedData,
          autoparseData: null,
          networkRequests: null,
          convertedContent: null,
          rawHtml,
          screenshotBase64: null,
          error: res.ok ? null : `HTTP ${res.status}`
        });

        if (res.ok) successCount++;
        else errorCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorCount++;

        await db.insert(scrapeResults).values({
          jobId,
          url,
          status: 0,
          originalStatus: 0,
          timing: 0,
          responseType: "error",
          extractedData: null,
          autoparseData: null,
          networkRequests: null,
          convertedContent: null,
          rawHtml: null,
          screenshotBase64: null,
          error: msg
        });
      }

      if (i < config.urls.length - 1 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // AI auto-parse if enabled in settings
    try {
      const aiSettings = await getAiSettings();
      if (aiSettings?.autoparse) {
        console.log(`[api-scrape:${jobId}] AI auto-parse starting (${aiSettings.provider}, mode: ${aiSettings.mode})`);
        await aiParseJobResults(jobId, aiSettings.provider, aiSettings.apiKey, aiSettings.mode);
        console.log(`[api-scrape:${jobId}] AI auto-parse completed`);
      }
    } catch (aiErr) {
      console.error(`[api-scrape:${jobId}] AI auto-parse failed:`, aiErr);
    }

    await db.update(scrapeJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        progress: { completed: totalUrls, total: totalUrls },
        resultSummary: {
          type: "api",
          resultsCount: successCount,
          errorsCount: errorCount
        }
      })
      .where(eq(scrapeJobs.id, jobId));

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(scrapeJobs)
      .set({ status: "failed", completedAt: new Date(), errorMessage: message })
      .where(eq(scrapeJobs.id, jobId));
  }
}
