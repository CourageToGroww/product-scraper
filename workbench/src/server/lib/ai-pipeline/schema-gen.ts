import fs from "node:fs";
import path from "node:path";
import { callLLMJson, type Provider } from "./llm-client.js";
import { SchemaSpecSchema, type SchemaSpec, type ColumnSpec } from "./types.js";

const SYSTEM_PROMPT = `You are a database schema designer. Given a sample of scraped rows (JSON objects), design a Postgres schema as a JSON SchemaSpec object.

Rules:
- Use snake_case for table and column names.
- Choose the smallest column type that fits all observed values across the sample.
- Allowed column types (exact strings): "text", "integer", "real", "boolean", "timestamp", "jsonb".
- Mark a column nullable=true if any sample value is null/missing; otherwise nullable=false.
- Add a description for each column when the role is non-obvious.
- Always include an "id" primary key.
- Return ONLY a JSON object of shape { "tables": [ { "name": "...", "primaryKey": "id", "columns": [ {...} ] } ] } - no markdown fences, no commentary.`;

export interface SchemaGenInput {
  jobId: number;
  provider: Provider;
  apiKey: string;
  model: string;
  /** A sample of rows to reason from (already de-duplicated, key-normalized). */
  sampleRows: Record<string, unknown>[];
  /** Suggested table name (typically the job name slug); LLM may override. */
  suggestedTableName: string;
}

export async function generateSchema(input: SchemaGenInput): Promise<SchemaSpec> {
  const sampleJson = JSON.stringify(input.sampleRows.slice(0, 20), null, 2);
  const userPrompt = `Suggested table name (override only if a clearer name fits): ${input.suggestedTableName}

Sample rows (up to 20):
${sampleJson}

Return the SchemaSpec JSON.`;

  return callLLMJson(input.provider, input.apiKey, SYSTEM_PROMPT, userPrompt, SchemaSpecSchema);
}

// Drizzle TS rendering

export function renderDrizzleSchema(spec: SchemaSpec): string {
  const lines: string[] = [];
  lines.push(`import { pgTable, text, integer, real, boolean, timestamp, jsonb, serial } from "drizzle-orm/pg-core";`);
  lines.push(`import { createSelectSchema, createInsertSchema } from "drizzle-zod";`);
  lines.push(``);

  for (const table of spec.tables) {
    lines.push(`export const ${camel(table.name)} = pgTable("${table.name}", {`);
    lines.push(`  id: serial("id").primaryKey(),`);
    for (const col of table.columns) {
      if (col.name === "id") continue;
      lines.push(`  ${camel(col.name)}: ${columnExpr(col)},`);
    }
    lines.push(`});`);
    lines.push(``);
    lines.push(`export const ${camel(table.name)}Select = createSelectSchema(${camel(table.name)});`);
    lines.push(`export const ${camel(table.name)}Insert = createInsertSchema(${camel(table.name)});`);
    lines.push(``);
  }
  return lines.join("\n");
}

function camel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function columnExpr(col: ColumnSpec): string {
  const builders: Record<string, string> = {
    text: `text("${col.name}")`,
    integer: `integer("${col.name}")`,
    real: `real("${col.name}")`,
    boolean: `boolean("${col.name}")`,
    timestamp: `timestamp("${col.name}")`,
    jsonb: `jsonb("${col.name}").$type<Record<string, unknown>>()`
  };
  let expr = builders[col.type];
  if (!col.nullable) expr += ".notNull()";
  return expr;
}

// Persist schema to disk

export interface PersistedSchema {
  filePath: string;
  schemaSpec: SchemaSpec;
  source: string;
}

export function persistSchemaToDisk(jobId: number, spec: SchemaSpec, jobsDir: string): PersistedSchema {
  const dir = path.join(jobsDir, String(jobId));
  fs.mkdirSync(dir, { recursive: true });
  const source = renderDrizzleSchema(spec);
  const filePath = path.join(dir, "schema.ts");
  fs.writeFileSync(filePath, source, "utf-8");
  return { filePath, schemaSpec: spec, source };
}
