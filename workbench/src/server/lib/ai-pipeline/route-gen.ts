import fs from "node:fs";
import path from "node:path";
import { callLLMJson, type Provider } from "./llm-client.js";
import { RouteSetSchema, type RouteSet, type SchemaSpec, type RouteSpec } from "./types.js";

const CRUD_SYSTEM_PROMPT = `You are an API endpoint designer. Given a Postgres schema, produce a JSON RouteSet describing CRUD endpoints for the primary table using the Hono framework with Drizzle ORM.

Rules:
- Generate at minimum: list (GET /), get-by-id (GET /:id), create (POST /), update (PATCH /:id), delete (DELETE /:id).
- Each route's "handlerSource" must be the BODY of an async function that receives a Hono context "c" and a Drizzle "db" client. It must NOT redeclare imports or function signatures - just the inner statements. Use "return c.json(...)".
- Reference the table by its variable name in camelCase.
- Use Zod schemas for request body validation; assume "createInsertSchema" + "createSelectSchema" from drizzle-zod are available as "<table>Insert" and "<table>Select".
- Return ONLY a RouteSet JSON object: { "resource": "...", "routes": [ {...} ] } - no markdown, no commentary.`;

const CUSTOM_SYSTEM_PROMPT = `You are an API endpoint designer. Add ONE custom Hono+Drizzle route to satisfy the user's request, returning a single RouteSpec JSON object (no array, no markdown). Same handlerSource rules as before.`;

export interface RouteGenInput {
  provider: Provider;
  apiKey: string;
  model: string;
  schemaSpec: SchemaSpec;
}

export async function generateCrudRoutes(input: RouteGenInput): Promise<RouteSet> {
  const userPrompt = `Schema spec:\n${JSON.stringify(input.schemaSpec, null, 2)}\n\nReturn the CRUD RouteSet JSON.`;
  return callLLMJson(input.provider, input.apiKey, CRUD_SYSTEM_PROMPT, userPrompt, RouteSetSchema);
}

export interface CustomRouteInput extends RouteGenInput {
  prompt: string;
}

export async function generateCustomRoute(input: CustomRouteInput): Promise<RouteSpec> {
  const userPrompt = `Schema spec:\n${JSON.stringify(input.schemaSpec, null, 2)}\n\nUser request: ${input.prompt}\n\nReturn ONE RouteSpec JSON object.`;
  const RouteSpecSingleSchema = RouteSetSchema.shape.routes.element;
  return callLLMJson(input.provider, input.apiKey, CUSTOM_SYSTEM_PROMPT, userPrompt, RouteSpecSingleSchema);
}

export function renderRouteFile(set: RouteSet, schemaSpec: SchemaSpec): string {
  const tableVar = camel(schemaSpec.tables[0].name);
  const lines: string[] = [];
  lines.push(`import { Hono } from "hono";`);
  lines.push(`import { eq } from "drizzle-orm";`);
  lines.push(`import { db } from "../db.js";`);
  lines.push(`import { ${tableVar}, ${tableVar}Insert, ${tableVar}Select } from "../schema.js";`);
  lines.push(``);
  lines.push(`const app = new Hono();`);
  lines.push(``);

  for (const r of set.routes) {
    const method = r.method.toLowerCase();
    lines.push(`// ${r.description}`);
    lines.push(`app.${method}("${r.path}", async (c) => {`);
    for (const handlerLine of r.handlerSource.split("\n")) {
      lines.push(`  ${handlerLine}`);
    }
    lines.push(`});`);
    lines.push(``);
  }

  lines.push(`export default app;`);
  return lines.join("\n");
}

export function persistRoutesToDisk(jobId: number, resource: string, source: string, jobsDir: string): string {
  const dir = path.join(jobsDir, String(jobId), "api", "src", "routes");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${resource}.ts`);
  fs.writeFileSync(filePath, source, "utf-8");
  return filePath;
}

function camel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
