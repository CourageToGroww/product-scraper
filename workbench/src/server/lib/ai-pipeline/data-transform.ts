import { aiParseJobResults } from "../ai-parser.js";
import type { Provider } from "./llm-client.js";
import type { ParseMode } from "../ai-parser.js";
import type { DataResult } from "./types.js";

export interface DataTransformInput {
  jobId: number;
  provider: Provider;
  apiKey: string;
  parseMode: ParseMode;
}

export async function runDataTransform(input: DataTransformInput): Promise<DataResult> {
  const start = Date.now();
  const result = await aiParseJobResults(input.jobId, input.provider, input.apiKey, input.parseMode);
  return {
    datasetId: result.datasetId,
    rowCount: result.rowCount,
    durationMs: Date.now() - start
  };
}
