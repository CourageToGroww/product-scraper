import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const SCRAPEKIT_ROOT = path.resolve(import.meta.dirname, "../../../../");

const HttpClient = require(path.join(SCRAPEKIT_ROOT, "lib/core/http-client"));
const cheerio = require("cheerio");

const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".tar", ".gz", ".mp4", ".mp3", ".webm",
  ".json", ".xml", ".txt", ".map"
]);

function isAssetUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return ASSET_EXTENSIONS.has(path.extname(pathname));
  } catch {
    return false;
  }
}

function normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    // Strip fragment
    url.hash = "";
    // Strip trailing slash for consistency (except root)
    let href = url.href;
    if (href.endsWith("/") && url.pathname !== "/") {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return null;
  }
}

// --- Sitemap Discovery ---

export async function discoverFromSitemap(
  baseUrl: string,
  options: { pathPrefix?: string; maxUrls?: number } = {}
): Promise<{ urls: string[]; method: string }> {
  const { pathPrefix, maxUrls = 5000 } = options;
  const client = new HttpClient({ timeout: 15000, retries: 2 });
  const found = new Set<string>();

  const origin = new URL(baseUrl).origin;

  // Try common sitemap locations
  const sitemapUrls = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-0.xml`
  ];

  async function parseSitemap(url: string, depth = 0): Promise<void> {
    if (depth > 3 || found.size >= maxUrls) return;

    try {
      const resp = await client.fetch(url);
      if (!resp.html || resp.status >= 400) return;

      const $ = cheerio.load(resp.html, { xmlMode: true });

      // Check for sitemap index (nested sitemaps)
      const nestedSitemaps: string[] = [];
      $("sitemap loc").each((_: number, el: any) => {
        const loc = $(el).text().trim();
        if (loc) nestedSitemaps.push(loc);
      });

      if (nestedSitemaps.length > 0) {
        for (const nested of nestedSitemaps) {
          if (found.size >= maxUrls) break;
          await parseSitemap(nested, depth + 1);
        }
        return;
      }

      // Extract URLs
      $("url loc").each((_: number, el: any) => {
        if (found.size >= maxUrls) return;
        const loc = $(el).text().trim();
        if (!loc) return;

        // Apply path prefix filter
        if (pathPrefix) {
          try {
            const parsed = new URL(loc);
            if (!parsed.pathname.startsWith(pathPrefix)) return;
          } catch {
            return;
          }
        }

        if (!isAssetUrl(loc)) {
          found.add(loc);
        }
      });
    } catch {
      // Sitemap not available, skip
    }
  }

  for (const sitemapUrl of sitemapUrls) {
    await parseSitemap(sitemapUrl);
    if (found.size > 0) break;
  }

  return {
    urls: Array.from(found).slice(0, maxUrls),
    method: "sitemap"
  };
}

// --- Link Crawling ---

export async function discoverFromCrawl(
  startUrl: string,
  options: {
    pathPrefix?: string;
    maxUrls?: number;
    maxDepth?: number;
    concurrency?: number;
  } = {}
): Promise<{ urls: string[]; method: string }> {
  const { pathPrefix, maxUrls = 500, maxDepth = 3, concurrency = 5 } = options;
  const client = new HttpClient({ timeout: 15000, retries: 1 });

  const startParsed = new URL(startUrl);
  const origin = startParsed.origin;
  const prefix = pathPrefix || startParsed.pathname;

  const visited = new Set<string>();
  const found = new Set<string>();

  // Normalize and add start URL
  const normalizedStart = normalizeUrl(startUrl, origin);
  if (normalizedStart) {
    found.add(normalizedStart);
  }

  // BFS queue: [url, depth]
  const queue: [string, number][] = [[startUrl, 0]];

  while (queue.length > 0 && found.size < maxUrls) {
    // Process in batches for concurrency
    const batch = queue.splice(0, concurrency);
    const fetches = batch.map(async ([url, depth]) => {
      if (visited.has(url) || depth > maxDepth) return;
      visited.add(url);

      try {
        const resp = await client.fetch(url);
        if (!resp.html || resp.status >= 400) return;

        const contentType = resp.headers?.["content-type"] || "";
        if (!contentType.includes("text/html") && !contentType.includes("text/xml")) return;

        const $ = cheerio.load(resp.html);

        $("a[href]").each((_: number, el: any) => {
          const href = $(el).attr("href");
          if (!href) return;

          // Skip non-http links
          if (href.startsWith("mailto:") || href.startsWith("tel:") ||
              href.startsWith("javascript:") || href === "#") return;

          const normalized = normalizeUrl(href, url);
          if (!normalized) return;

          // Same origin only
          try {
            const parsed = new URL(normalized);
            if (parsed.origin !== origin) return;

            // Path prefix filter
            if (prefix !== "/" && !parsed.pathname.startsWith(prefix)) return;

            // Skip assets
            if (isAssetUrl(normalized)) return;

            if (!found.has(normalized) && found.size < maxUrls) {
              found.add(normalized);
              if (depth + 1 <= maxDepth && !visited.has(normalized)) {
                queue.push([normalized, depth + 1]);
              }
            }
          } catch {
            // Invalid URL
          }
        });
      } catch {
        // Fetch failed, skip
      }
    });

    await Promise.all(fetches);
  }

  return {
    urls: Array.from(found).sort(),
    method: "crawl"
  };
}

// --- Browser-Based Crawling (for JS-rendered SPAs) ---

export async function discoverFromBrowserCrawl(
  startUrl: string,
  options: {
    pathPrefix?: string;
    maxUrls?: number;
    maxDepth?: number;
  } = {}
): Promise<{ urls: string[]; method: string }> {
  const { pathPrefix, maxUrls = 500, maxDepth = 3 } = options;

  const startParsed = new URL(startUrl);
  const origin = startParsed.origin;
  const prefix = pathPrefix || startParsed.pathname;

  const BrowserClient = require(path.join(SCRAPEKIT_ROOT, "lib/core/browser-client"));
  const client = new BrowserClient({ timeout: 20000 });

  const visited = new Set<string>();
  const found = new Set<string>();

  const normalizedStart = normalizeUrl(startUrl, origin);
  if (normalizedStart) found.add(normalizedStart);

  const queue: [string, number][] = [[startUrl, 0]];

  try {
    await client.launch();

    while (queue.length > 0 && found.size < maxUrls) {
      const [url, depth] = queue.shift()!;
      if (visited.has(url) || depth > maxDepth) continue;
      visited.add(url);

      try {
        const resp = await client.fetch(url);
        const page = resp._page;

        // Extract links via JS evaluation (catches SPA-rendered navigation)
        const links: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]")).map((a: any) => a.href)
        );

        await client.closePage(page);

        for (const href of links) {
          if (!href || href.startsWith("mailto:") || href.startsWith("tel:") ||
              href.startsWith("javascript:") || href === "#") continue;

          const normalized = normalizeUrl(href, url);
          if (!normalized) continue;

          try {
            const parsed = new URL(normalized);
            if (parsed.origin !== origin) continue;
            if (prefix !== "/" && !parsed.pathname.startsWith(prefix)) continue;
            if (isAssetUrl(normalized)) continue;

            if (!found.has(normalized) && found.size < maxUrls) {
              found.add(normalized);
              if (depth + 1 <= maxDepth && !visited.has(normalized)) {
                queue.push([normalized, depth + 1]);
              }
            }
          } catch {
            // Invalid URL
          }
        }
      } catch {
        // Fetch failed, skip
      }
    }
  } finally {
    await client.close();
  }

  return {
    urls: Array.from(found).sort(),
    method: "browser-crawl"
  };
}

// --- Combined Auto-Discovery ---

export async function discoverUrls(
  url: string,
  options: {
    method?: "auto" | "sitemap" | "crawl";
    pathPrefix?: string;
    maxUrls?: number;
    maxDepth?: number;
    jsRender?: boolean;
  } = {}
): Promise<{ urls: string[]; method: string; count: number }> {
  const { method = "auto", maxUrls = 2000, maxDepth = 3, jsRender = false } = options;

  // Auto-derive pathPrefix from URL if not provided
  const parsed = new URL(url);
  const pathPrefix = options.pathPrefix ??
    (parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : undefined);

  if (method === "sitemap") {
    const result = await discoverFromSitemap(url, { pathPrefix, maxUrls });
    return { ...result, count: result.urls.length };
  }

  if (method === "crawl") {
    const crawlFn = jsRender ? discoverFromBrowserCrawl : discoverFromCrawl;
    const result = await crawlFn(url, { pathPrefix, maxUrls, maxDepth });
    return { ...result, count: result.urls.length };
  }

  // Auto: try sitemap first, fall back to crawl
  const sitemapResult = await discoverFromSitemap(url, { pathPrefix, maxUrls });

  if (sitemapResult.urls.length > 0) {
    return {
      urls: sitemapResult.urls,
      method: "sitemap",
      count: sitemapResult.urls.length
    };
  }

  // Sitemap empty — crawl instead (use browser if jsRender requested)
  const crawlFn = jsRender ? discoverFromBrowserCrawl : discoverFromCrawl;
  const crawlResult = await crawlFn(url, { pathPrefix, maxUrls, maxDepth });
  return {
    urls: crawlResult.urls,
    method: crawlResult.method,
    count: crawlResult.urls.length
  };
}
