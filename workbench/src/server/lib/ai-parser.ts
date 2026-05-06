import { db } from "./db.js";
import { decryptSecret } from "./crypto/secret-cipher.js";
import { scrapeResults, datasets, datasetRows, settings as settingsTable } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { spawnDatasetDatabase } from "./docker-manager.js";

// ── Provider Configuration ──────────────────────────────────────────

export type Provider = "claude" | "openai" | "gemini" | "deepseek" | "kimi";

interface ProviderConfig {
  url: string;
  model: string;
  /** If true, uses Claude's unique API format instead of OpenAI-compatible */
  isClaude?: boolean;
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  claude: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-5-20250514",
    isClaude: true
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini"
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.0-flash"
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-v4-pro"
  },
  kimi: {
    url: "https://api.moonshot.cn/v1/chat/completions",
    model: "kimi-k2-0711-preview"
  }
};

// ── Parse Modes ─────────────────────────────────────────────────────

export type ParseMode = "general" | "ecommerce" | "articles" | "contacts" | "real_estate" | "jobs";

export const PARSE_MODES: Record<ParseMode, { label: string; description: string; systemPrompt: string }> = {
  general: {
    label: "General",
    description: "Auto-detect and extract any structured data",
    systemPrompt: `You are a data extraction assistant. Given web page content or API response data, extract structured data as a JSON array of objects.

Rules:
- Each object must have the same consistent keys
- Extract the main repeating entities (products, articles, listings, rows, etc.)
- Use descriptive snake_case key names
- Return ONLY valid JSON — no markdown fences, no explanations, no extra text
- If the content has only one entity, return a single-element array
- Flatten nested objects where reasonable (e.g. "price_amount" instead of nested "price.amount")`
  },

  ecommerce: {
    label: "Ecommerce (Shopify)",
    description: "Product data in Shopify CSV-compatible format",
    systemPrompt: `You are a product data extraction assistant specialized in ecommerce. Extract product data from the content and return it as a JSON array compatible with Shopify's product CSV import format.

Each product object MUST use these exact column names where data is available:
- "title" — product name
- "handle" — URL-friendly slug (lowercase, hyphens, no spaces). Generate from title if not found.
- "body_html" — product description (can include HTML)
- "vendor" — brand or manufacturer
- "product_type" — category or type
- "tags" — comma-separated tags
- "published" — "TRUE" or "FALSE"
- "variant_price" — price as a number
- "variant_compare_at_price" — original/compare price if on sale
- "variant_sku" — SKU code
- "variant_grams" — weight in grams
- "variant_inventory_qty" — stock quantity
- "variant_weight_unit" — "g", "kg", "lb", or "oz"
- "image_src" — main image URL
- "image_alt_text" — image alt text
- "option1_name" — first variant option name (e.g. "Size", "Color")
- "option1_value" — first variant option value
- "option2_name" — second variant option name
- "option2_value" — second variant option value
- "status" — "active", "draft", or "archived"

Rules:
- Return ONLY valid JSON — no markdown fences, no explanations
- Each object must have the same keys (use null for missing values)
- If a product has multiple variants, create one row per variant with the same title/handle
- If a product has multiple images, put the first in image_src, list others as additional rows with only handle + image_src filled
- Extract ALL products found in the content`
  },

  articles: {
    label: "Articles / Blog",
    description: "Blog posts, news articles, and editorial content",
    systemPrompt: `You are a content extraction assistant specialized in articles and blog posts. Extract article data from the content and return it as a JSON array.

Each article object MUST use these exact column names where data is available:
- "title" — article headline
- "author" — author name
- "published_date" — publication date (ISO 8601 format preferred, e.g. "2025-01-15")
- "content" — full article body text (truncate to 2000 chars if very long)
- "excerpt" — short summary or first paragraph (max 300 chars)
- "category" — article category or section
- "tags" — comma-separated tags or topics
- "url" — article URL
- "image_url" — featured/hero image URL
- "source" — publication or website name
- "reading_time_min" — estimated reading time in minutes (calculate from content length if not provided)

Rules:
- Return ONLY valid JSON — no markdown fences, no explanations
- Each object must have the same keys (use null for missing values)
- Extract ALL articles found in the content`
  },

  contacts: {
    label: "Contacts / Directory",
    description: "People, companies, and directory listings",
    systemPrompt: `You are a contact data extraction assistant. Extract contact/directory information from the content and return it as a JSON array.

Each contact object MUST use these exact column names where data is available:
- "name" — full name of person or organization
- "email" — email address
- "phone" — phone number (include country code if available)
- "company" — company or organization name
- "job_title" — role or position
- "department" — department or division
- "address" — street address
- "city" — city name
- "state" — state or province
- "country" — country
- "postal_code" — ZIP or postal code
- "website" — website URL
- "linkedin" — LinkedIn profile URL
- "bio" — short biography or description

Rules:
- Return ONLY valid JSON — no markdown fences, no explanations
- Each object must have the same keys (use null for missing values)
- Extract ALL contacts/people/companies found in the content
- Do NOT fabricate data — only extract what is actually present`
  },

  real_estate: {
    label: "Real Estate",
    description: "Property and real estate listings",
    systemPrompt: `You are a real estate data extraction assistant. Extract property listing data from the content and return it as a JSON array.

Each property object MUST use these exact column names where data is available:
- "address" — full street address
- "city" — city
- "state" — state or province
- "zip_code" — postal/ZIP code
- "price" — listing price as a number (no currency symbols)
- "currency" — currency code (e.g. "USD", "THB", "EUR")
- "bedrooms" — number of bedrooms
- "bathrooms" — number of bathrooms
- "sqft" — square footage or square meters
- "area_unit" — "sqft" or "sqm"
- "lot_size" — lot size
- "property_type" — "house", "condo", "apartment", "townhouse", "land", etc.
- "listing_type" — "sale" or "rent"
- "description" — property description (truncate to 1000 chars)
- "image_url" — main listing image URL
- "listing_url" — URL to the full listing
- "agent_name" — listing agent name
- "agent_phone" — agent phone number
- "year_built" — year the property was built
- "amenities" — comma-separated amenities

Rules:
- Return ONLY valid JSON — no markdown fences, no explanations
- Each object must have the same keys (use null for missing values)
- Extract ALL properties found in the content`
  },

  jobs: {
    label: "Job Postings",
    description: "Job listings and career opportunities",
    systemPrompt: `You are a job data extraction assistant. Extract job posting data from the content and return it as a JSON array.

Each job object MUST use these exact column names where data is available:
- "title" — job title
- "company" — company name
- "location" — job location (city, state/country)
- "remote" — "remote", "hybrid", "onsite", or "flexible"
- "salary_min" — minimum salary as a number
- "salary_max" — maximum salary as a number
- "salary_currency" — currency code (e.g. "USD")
- "salary_period" — "annual", "monthly", "hourly"
- "job_type" — "full-time", "part-time", "contract", "internship", "freelance"
- "experience_level" — "entry", "mid", "senior", "lead", "executive"
- "description" — job description (truncate to 1500 chars)
- "requirements" — key requirements, comma-separated
- "benefits" — benefits, comma-separated
- "skills" — required skills, comma-separated
- "url" — job posting URL
- "posted_date" — date posted (ISO 8601)
- "deadline" — application deadline (ISO 8601)
- "department" — department name

Rules:
- Return ONLY valid JSON — no markdown fences, no explanations
- Each object must have the same keys (use null for missing values)
- Extract ALL job postings found in the content`
  }
};

// ── LLM Call ────────────────────────────────────────────────────────

export async function callLLM(
  provider: Provider,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    let res: Response;

    if (config.isClaude) {
      res = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        }),
        signal: controller.signal
      });
    } else {
      // OpenAI-compatible format (OpenAI, Gemini, DeepSeek, Kimi)
      res = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8192,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }),
        signal: controller.signal
      });
    }

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`${provider} API error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();

    // Extract text from response
    if (config.isClaude) {
      // Claude: { content: [{ type: "text", text: "..." }] }
      return data.content?.[0]?.text || "";
    } else {
      // OpenAI-compatible: { choices: [{ message: { content: "..." } }] }
      return data.choices?.[0]?.message?.content || "";
    }
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Content Preparation ─────────────────────────────────────────────

/** Max chars to send per LLM call (fits comfortably within 64K-128K context windows) */
const CHUNK_CHAR_LIMIT = 48000;

/** Strip HTML tags and collapse whitespace to get usable text from raw HTML */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Get the full content string for a single result (no truncation) */
function getFullContent(result: {
  url: string;
  convertedContent: string | null;
  rawHtml: string | null;
  extractedData: Record<string, unknown> | null;
  networkRequests: unknown[] | null;
}): string {
  const parts: string[] = [];

  // Network requests are the richest source — they contain the page's own API responses
  if (result.networkRequests && Array.isArray(result.networkRequests) && result.networkRequests.length > 0) {
    const jsonResponses = (result.networkRequests as any[]).filter((r: any) =>
      r.body && typeof r.body === "object" && r.status >= 200 && r.status < 400
    );
    if (jsonResponses.length > 0) {
      const networkJson = JSON.stringify(
        jsonResponses.map((r: any) => ({ url: r.url, data: r.body })),
        null, 2
      );
      parts.push(`--- Captured API responses (XHR/Fetch) ---\n${networkJson}`);
    }
  }

  // Then prefer extracted JSON > markdown > stripped HTML
  if (result.extractedData) {
    parts.push(`--- Extracted data ---\n${JSON.stringify(result.extractedData, null, 2)}`);
  } else if (result.convertedContent) {
    parts.push(`--- Page content ---\n${result.convertedContent}`);
  } else if (result.rawHtml) {
    const text = stripHtml(result.rawHtml);
    parts.push(`--- Page text ---\n${text}`);
  }

  return parts.join("\n\n") || "";
}

/**
 * Split content into chunks that each fit within CHUNK_CHAR_LIMIT.
 * Tries to split on paragraph/line boundaries for cleaner cuts.
 */
function chunkContent(content: string, limit: number = CHUNK_CHAR_LIMIT): string[] {
  if (content.length <= limit) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to find a clean break point within the limit
    let breakAt = limit;
    // Look for paragraph break (\n\n)
    const paraBreak = remaining.lastIndexOf("\n\n", limit);
    if (paraBreak > limit * 0.5) {
      breakAt = paraBreak + 2;
    } else {
      // Fall back to line break
      const lineBreak = remaining.lastIndexOf("\n", limit);
      if (lineBreak > limit * 0.5) {
        breakAt = lineBreak + 1;
      }
    }

    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }

  return chunks;
}

// ── Response Parsing ────────────────────────────────────────────────

function parseAIResponse(text: string): Record<string, unknown>[] {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const parsed = JSON.parse(cleaned);

  if (Array.isArray(parsed)) {
    // Validate all elements are objects
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item)
    );
  }

  if (typeof parsed === "object" && parsed !== null) {
    // Check if it wraps an array (e.g. { "data": [...] } or { "items": [...] })
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
        return (parsed[key] as unknown[]).filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && !Array.isArray(item)
        );
      }
    }
    // Single object — wrap in array
    return [parsed as Record<string, unknown>];
  }

  throw new Error("AI response is not a valid JSON array or object");
}

// ── Main Parse Function ─────────────────────────────────────────────

export async function aiParseJobResults(
  jobId: number,
  provider: Provider,
  apiKey: string,
  mode: ParseMode = "general"
): Promise<{ datasetId: number; rowCount: number }> {
  const modeConfig = PARSE_MODES[mode] || PARSE_MODES.general;

  // Load results
  const results = await db.select().from(scrapeResults).where(eq(scrapeResults.jobId, jobId));

  if (results.length === 0) {
    throw new Error("No results to parse");
  }

  // Filter to results with usable content
  const usable = results.filter(r =>
    r.convertedContent || r.extractedData || r.rawHtml ||
    (r.networkRequests && Array.isArray(r.networkRequests) && r.networkRequests.length > 0)
  );

  if (usable.length === 0) {
    throw new Error("No results with parseable content");
  }

  const allRows: Record<string, unknown>[] = [];
  const batchErrors: string[] = [];
  let callCount = 0;

  // Process each result individually, chunking large ones across multiple LLM calls
  for (let ri = 0; ri < usable.length; ri++) {
    const r = usable[ri];
    const fullContent = getFullContent(r);

    if (!fullContent) {
      console.log(`[ai-parse:${jobId}] Result ${ri + 1}/${usable.length} (${r.url}): no content, skipping`);
      continue;
    }

    const header = `--- Content from ${r.url} ---\n`;
    const chunks = chunkContent(fullContent);

    console.log(`[ai-parse:${jobId}] Result ${ri + 1}/${usable.length} (${r.url}): ${fullContent.length} chars → ${chunks.length} chunk(s)`);

    for (let ci = 0; ci < chunks.length; ci++) {
      callCount++;
      const chunkLabel = chunks.length > 1 ? ` (chunk ${ci + 1}/${chunks.length})` : "";
      const chunkNote = chunks.length > 1
        ? `\n\nNote: This is part ${ci + 1} of ${chunks.length} of a large page. Extract all data you find in this portion.`
        : "";

      const userPrompt = `Extract structured data from the following page content. Return a single JSON array containing all extracted rows.${chunkNote}\n\n${header}${chunks[ci]}`;

      try {
        console.log(`[ai-parse:${jobId}] Call ${callCount}: result ${ri + 1}${chunkLabel}, sending ${userPrompt.length} chars to ${provider} (mode: ${mode})`);
        const response = await callLLM(provider, apiKey, modeConfig.systemPrompt, userPrompt);
        console.log(`[ai-parse:${jobId}] Call ${callCount}: got ${response.length} chars back`);
        const parsed = parseAIResponse(response);
        console.log(`[ai-parse:${jobId}] Call ${callCount}: parsed ${parsed.length} rows`);
        for (const row of parsed) {
          allRows.push(row);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ai-parse:${jobId}] Call ${callCount} failed:`, msg);
        batchErrors.push(`Result ${ri + 1}${chunkLabel}: ${msg}`);
        // Continue with other chunks/results
      }
    }
  }

  console.log(`[ai-parse:${jobId}] Done: ${callCount} LLM call(s), ${allRows.length} total rows, ${batchErrors.length} errors`);

  if (allRows.length === 0) {
    const detail = batchErrors.length > 0
      ? `AI parsing produced no rows after ${callCount} LLM call(s). Errors: ${batchErrors.join("; ")}`
      : "AI parsing produced no rows";
    throw new Error(detail);
  }

  // Deduplicate rows — if chunks from the same page return overlapping data
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const row of allRows) {
    // Create a content fingerprint from sorted key-value pairs
    const fingerprint = JSON.stringify(
      Object.entries(row).sort(([a], [b]) => a.localeCompare(b))
    );
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      deduped.push(row);
    }
  }

  if (deduped.length < allRows.length) {
    console.log(`[ai-parse:${jobId}] Deduplication: ${allRows.length} → ${deduped.length} rows (removed ${allRows.length - deduped.length} duplicates)`);
  }

  const finalRows = deduped;

  // Normalize keys — use union of all keys across all rows
  const allKeys = new Set<string>();
  for (const row of finalRows) {
    for (const key of Object.keys(row)) allKeys.add(key);
  }
  const normalizedRows = finalRows.map(row => {
    const normalized: Record<string, unknown> = {};
    for (const key of allKeys) {
      normalized[key] = row[key] ?? null;
    }
    return normalized;
  });

  // Build schema
  const schema: Record<string, string> = {};
  const firstRow = normalizedRows[0];
  for (const [k, v] of Object.entries(firstRow)) {
    schema[k] = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
  }

  const datasetName = `AI Parsed (${modeConfig.label}) - Job #${jobId}`;

  // Create dataset
  const [dataset] = await db.insert(datasets).values({
    name: datasetName,
    description: `Parsed by ${provider} AI (${modeConfig.label} mode) from ${usable.length} results`,
    sourceJobId: jobId,
    schema,
    rowCount: normalizedRows.length,
    extractionConfig: { mode: "ai-parse", config: { provider, parseMode: mode } }
  }).returning();

  // Insert rows in batches of 500
  const rowValues = normalizedRows.map((data, i) => ({
    datasetId: dataset.id,
    data,
    rowIndex: i
  }));

  for (let i = 0; i < rowValues.length; i += 500) {
    await db.insert(datasetRows).values(rowValues.slice(i, i + 500));
  }

  // Spawn Docker DB async (fire-and-forget)
  spawnDatasetDatabase(dataset.id, datasetName, Object.keys(schema), normalizedRows)
    .then((spawn) => {
      db.update(datasets)
        .set({
          databasePort: spawn.port,
          databaseContainerId: spawn.containerId,
          databaseStatus: "running"
        })
        .where(eq(datasets.id, dataset.id))
        .catch(() => {});
    })
    .catch(() => {
      db.update(datasets)
        .set({ databaseStatus: "none" })
        .where(eq(datasets.id, dataset.id))
        .catch(() => {});
    });

  return { datasetId: dataset.id, rowCount: normalizedRows.length };
}

// ── Load Settings Helper ────────────────────────────────────────────

export async function getAiSettings(): Promise<{
  provider: Provider;
  apiKey: string;
  autoparse: boolean;
  mode: ParseMode;
} | null> {
  const [row] = await db.select().from(settingsTable).limit(1);
  if (!row?.aiProvider) return null;

  const provider = row.aiProvider as Provider;
  const keyMap: Record<Provider, string | null> = {
    claude: row.claudeApiKey,
    openai: row.openaiApiKey,
    gemini: row.geminiApiKey,
    deepseek: row.deepseekApiKey,
    kimi: row.kimiApiKey
  };

  const apiKey = decryptSecret(keyMap[provider]);
  if (!apiKey) return null;

  return {
    provider,
    apiKey,
    autoparse: row.aiAutoparse,
    mode: (row.aiParseMode as ParseMode) || "general"
  };
}
