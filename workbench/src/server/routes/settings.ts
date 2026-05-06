import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { settings } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { validateBody, type Env } from "../middleware/validate.js";
import { aiParseJobResults, getAiSettings, PARSE_MODES, type ParseMode } from "../lib/ai-parser.js";
import { encryptSecret, decryptSecret } from "../lib/crypto/secret-cipher.js";

const app = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────────────

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "****";
  return key.slice(0, 3) + "..." + key.slice(-4);
}

// ── GET /api/settings ───────────────────────────────────────────────

app.get("/", async (c) => {
  const [row] = await db.select().from(settings).limit(1);

  if (!row) {
    return c.json({
      aiProvider: null,
      aiAutoparse: false,
      aiParseMode: "general",
      parseModes: Object.entries(PARSE_MODES).map(([k, v]) => ({ value: k, label: v.label, description: v.description })),
      claudeApiKey: null,
      openaiApiKey: null,
      geminiApiKey: null,
      deepseekApiKey: null,
      kimiApiKey: null
    });
  }

  return c.json({
    aiProvider: row.aiProvider,
    aiAutoparse: row.aiAutoparse,
    aiParseMode: row.aiParseMode,
    parseModes: Object.entries(PARSE_MODES).map(([k, v]) => ({ value: k, label: v.label, description: v.description })),
    claudeApiKey: maskKey(decryptSecret(row.claudeApiKey)),
    openaiApiKey: maskKey(decryptSecret(row.openaiApiKey)),
    geminiApiKey: maskKey(decryptSecret(row.geminiApiKey)),
    deepseekApiKey: maskKey(decryptSecret(row.deepseekApiKey)),
    kimiApiKey: maskKey(decryptSecret(row.kimiApiKey))
  });
});

// ── PUT /api/settings ───────────────────────────────────────────────

const updateSchema = z.object({
  aiProvider: z.enum(["claude", "openai", "gemini", "deepseek", "kimi"]).nullable().optional(),
  aiAutoparse: z.boolean().optional(),
  aiParseMode: z.enum(["general", "ecommerce", "articles", "contacts", "real_estate", "jobs"]).optional(),
  claudeApiKey: z.string().min(1).optional(),
  openaiApiKey: z.string().min(1).optional(),
  geminiApiKey: z.string().min(1).optional(),
  deepseekApiKey: z.string().min(1).optional(),
  kimiApiKey: z.string().min(1).optional()
});

app.put("/", validateBody(updateSchema), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof updateSchema>;

  // Build update object — only include fields that were provided
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.aiProvider !== undefined) updateData.aiProvider = body.aiProvider;
  if (body.aiAutoparse !== undefined) updateData.aiAutoparse = body.aiAutoparse;
  if (body.aiParseMode !== undefined) updateData.aiParseMode = body.aiParseMode;
  if (body.claudeApiKey !== undefined) updateData.claudeApiKey = encryptSecret(body.claudeApiKey);
  if (body.openaiApiKey !== undefined) updateData.openaiApiKey = encryptSecret(body.openaiApiKey);
  if (body.geminiApiKey !== undefined) updateData.geminiApiKey = encryptSecret(body.geminiApiKey);
  if (body.deepseekApiKey !== undefined) updateData.deepseekApiKey = encryptSecret(body.deepseekApiKey);
  if (body.kimiApiKey !== undefined) updateData.kimiApiKey = encryptSecret(body.kimiApiKey);

  // Upsert: try update first, insert if no row exists
  const [existing] = await db.select({ id: settings.id }).from(settings).limit(1);

  if (existing) {
    await db.update(settings).set(updateData).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values(updateData as any);
  }

  return c.json({ ok: true });
});

// ── POST /api/ai-parse ──────────────────────────────────────────────

const aiParseSchema = z.object({
  jobId: z.number().int().positive(),
  mode: z.enum(["general", "ecommerce", "articles", "contacts", "real_estate", "jobs"]).optional()
});

app.post("/ai-parse", validateBody(aiParseSchema), async (c) => {
  const { jobId, mode } = c.get("validatedBody") as z.infer<typeof aiParseSchema>;

  const aiSettings = await getAiSettings();
  if (!aiSettings) {
    return c.json({ error: "No AI provider configured. Go to Settings to add an API key." }, 400);
  }

  // Use mode from request body, fall back to settings default
  const parseMode: ParseMode = mode || aiSettings.mode;

  try {
    const result = await aiParseJobResults(jobId, aiSettings.provider, aiSettings.apiKey, parseMode);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `AI parsing failed: ${msg}` }, 500);
  }
});

export default app;
