import { z, ZodTypeAny } from "zod";
import { callLLM, PROVIDERS, type Provider } from "../ai-parser.js";

export { callLLM, PROVIDERS, type Provider };

/**
 * Call the LLM and parse the response as JSON validated against the given Zod schema.
 * Strips markdown fences. Throws if the response cannot be parsed or fails validation.
 */
export async function callLLMJson<T extends ZodTypeAny>(
  provider: Provider,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  schema: T
): Promise<z.infer<T>> {
  const raw = await callLLM(provider, apiKey, systemPrompt, userPrompt);

  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM returned invalid JSON: ${msg}\nFirst 300 chars: ${cleaned.slice(0, 300)}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `LLM JSON failed schema validation: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }

  return result.data;
}

export { getAiSettings } from "../ai-parser.js";
