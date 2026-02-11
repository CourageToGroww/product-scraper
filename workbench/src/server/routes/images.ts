import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { scrapeJobs, scrapeResults } from "../../db/schema.js";
import { eq } from "drizzle-orm";

import { validateBody, type Env } from "../middleware/validate.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";

const CACHE_DIR = path.join(os.homedir(), ".scrapekit", "image-cache");

// Ensure cache directory exists
fs.mkdirSync(CACHE_DIR, { recursive: true });

const app = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function urlHash(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 20);
}

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("bmp")) return ".bmp";
  if (ct.includes("ico")) return ".ico";
  return ".jpg";
}

function extFromUrl(url: string): string {
  const m = url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|$)/i);
  if (m) {
    const e = m[1].toLowerCase();
    return e === "jpeg" ? ".jpg" : `.${e}`;
  }
  return "";
}

function contentTypeFromExt(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
    ".bmp": "image/bmp", ".ico": "image/x-icon"
  };
  return map[ext] || "application/octet-stream";
}

/** Find cached file for a URL (checks all possible extensions) */
function findCached(hash: string): { path: string; ext: string } | null {
  for (const ext of [".jpg", ".png", ".webp", ".gif", ".svg", ".bmp", ".ico"]) {
    const p = path.join(CACHE_DIR, `${hash}${ext}`);
    if (fs.existsSync(p)) return { path: p, ext };
  }
  return null;
}

/** Fetch an image, cache it, return the cached file info */
async function fetchAndCache(url: string): Promise<{ filePath: string; ext: string; contentType: string; size: number }> {
  const hash = urlHash(url);
  const existing = findCached(hash);
  if (existing) {
    const stat = fs.statSync(existing.path);
    return { filePath: existing.path, ext: existing.ext, contentType: contentTypeFromExt(existing.ext), size: stat.size };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = res.headers.get("content-type") || "";
    const ext = extFromContentType(ct) || extFromUrl(url) || ".jpg";
    const buffer = Buffer.from(await res.arrayBuffer());

    const filePath = path.join(CACHE_DIR, `${hash}${ext}`);
    fs.writeFileSync(filePath, buffer);

    return { filePath, ext, contentType: ct || contentTypeFromExt(ext), size: buffer.length };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Image URL Extraction ────────────────────────────────────

const IMAGE_KEY_RE = /image|photo|thumbnail|avatar|icon|logo|cover|banner|poster|picture|img_url|photo_url/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|#|$)/i;

function findImageUrls(obj: unknown, urls: Set<string>, depth = 0): void {
  if (depth > 10) return;
  if (typeof obj === "string") {
    if (/^https?:\/\//i.test(obj) && IMAGE_EXT_RE.test(obj)) urls.add(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) findImageUrls(item, urls, depth + 1);
    return;
  }
  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      if (IMAGE_KEY_RE.test(key) && typeof value === "string" && /^https?:\/\//i.test(value)) {
        urls.add(value);
      } else {
        findImageUrls(value, urls, depth + 1);
      }
    }
  }
}

// ── Routes ──────────────────────────────────────────────────

// Proxy: fetch image, cache to disk, serve
app.get("/proxy", async (c) => {
  const url = c.req.query("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return c.json({ error: "Invalid URL" }, 400);
  }

  try {
    const cached = await fetchAndCache(url);
    const stream = fs.createReadStream(cached.filePath);

    c.header("Content-Type", cached.contentType);
    c.header("Content-Length", String(cached.size));
    c.header("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Content-Length": String(cached.size),
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to fetch image: ${msg}` }, 502);
  }
});

// Pre-cache all images for a job
const precacheSchema = z.object({
  jobId: z.number().int().positive()
});

app.post("/precache", validateBody(precacheSchema), async (c) => {
  const { jobId } = c.get("validatedBody") as z.infer<typeof precacheSchema>;

  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId));
  if (!job) return c.json({ error: "Job not found" }, 404);

  // Get results from main database
  const results = await db.select().from(scrapeResults).where(eq(scrapeResults.jobId, jobId));

  // Collect unique image URLs
  const urls = new Set<string>();
  for (const r of results) {
    if (r.extractedData) findImageUrls(r.extractedData, urls);
    if (r.autoparseData?.images) {
      for (const img of r.autoparseData.images as any[]) {
        if (img.src && /^https?:\/\//i.test(img.src)) urls.add(img.src);
      }
    }
  }

  let cached = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      await fetchAndCache(url);
      cached++;
    } catch {
      failed++;
    }
  }

  return c.json({ total: urls.size, cached, failed });
});

export default app;
