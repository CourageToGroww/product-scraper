import path from "node:path";
import { db } from "../db.js";
import { aiPipelines, honoServices } from "../../../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { callLLMJson, type Provider, getAiSettings, PROVIDERS } from "./llm-client.js";
import { SchemaSpecSchema, RouteSetSchema, type SchemaSpec, type RouteSet } from "./types.js";
import { renderDrizzleSchema, persistSchemaToDisk } from "./schema-gen.js";
import { renderRouteFile, persistRoutesToDisk } from "./route-gen.js";
import { startPipelineRun, completePipelineRun, failPipelineRun } from "./store.js";

const JOBS_DIR = path.join(process.cwd(), "jobs");

const SCHEMA_EDIT_SYSTEM = `You are editing an existing SchemaSpec. The user gives a natural-language change request. Apply the change and return the FULL updated SchemaSpec (not a diff). Same SchemaSpec rules as before: snake_case identifiers, allowed types {text, integer, real, boolean, timestamp, jsonb}, always include "id" primary key. Return ONLY the JSON object.`;

const ROUTES_EDIT_SYSTEM = `You are editing an existing RouteSet. The user gives a natural-language change request (often "add a route that..."). Return the FULL updated RouteSet with the new/modified routes included alongside existing ones. handlerSource rules unchanged. Return ONLY the JSON object.`;

async function getLatestSchemaSpec(jobId: number): Promise<SchemaSpec | null> {
  const [row] = await db.select().from(aiPipelines)
    .where(and(eq(aiPipelines.jobId, jobId), eq(aiPipelines.phase, "schema"), eq(aiPipelines.status, "completed")))
    .orderBy(desc(aiPipelines.id)).limit(1);
  if (!row || !row.output) return null;
  return (row.output as { schemaSpec?: SchemaSpec }).schemaSpec ?? null;
}

async function getLatestRouteSet(jobId: number): Promise<RouteSet | null> {
  const [row] = await db.select().from(aiPipelines)
    .where(and(eq(aiPipelines.jobId, jobId), eq(aiPipelines.phase, "api"), eq(aiPipelines.status, "completed")))
    .orderBy(desc(aiPipelines.id)).limit(1);
  if (!row || !row.output) return null;
  return (row.output as { routeSet?: RouteSet }).routeSet ?? null;
}

export async function editSchemaWithAi(jobId: number, prompt: string): Promise<{ schemaSpec: SchemaSpec; schemaSource: string }> {
  const settings = await getAiSettings();
  if (!settings) throw new Error("No AI provider configured");
  const provider = settings.provider as Provider;
  const model = PROVIDERS[provider].model;

  const current = await getLatestSchemaSpec(jobId);
  if (!current) throw new Error("No existing schema found; run the schema phase first");

  const run = await startPipelineRun({ jobId, phase: "schema", provider, model, inputSummary: { edit: true, prompt } });
  try {
    const userPrompt = `Current SchemaSpec:\n${JSON.stringify(current, null, 2)}\n\nUser change request: ${prompt}\n\nReturn the full updated SchemaSpec JSON.`;
    const updated = await callLLMJson(provider, settings.apiKey, SCHEMA_EDIT_SYSTEM, userPrompt, SchemaSpecSchema);
    persistSchemaToDisk(jobId, updated, JOBS_DIR);
    const schemaSource = renderDrizzleSchema(updated);
    await completePipelineRun(run.id, { output: { schemaSpec: updated, edit: true } });
    return { schemaSpec: updated, schemaSource };
  } catch (err) {
    await failPipelineRun(run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function editRoutesWithAi(jobId: number, prompt: string): Promise<{ routeSet: RouteSet; routeSource: string }> {
  const settings = await getAiSettings();
  if (!settings) throw new Error("No AI provider configured");
  const provider = settings.provider as Provider;
  const model = PROVIDERS[provider].model;

  const schemaSpec = await getLatestSchemaSpec(jobId);
  if (!schemaSpec) throw new Error("No schema found; run the schema phase first");
  const current = await getLatestRouteSet(jobId);
  if (!current) throw new Error("No existing routes found; run the api phase first");

  const run = await startPipelineRun({ jobId, phase: "api", provider, model, inputSummary: { edit: true, prompt } });
  try {
    const userPrompt = `Current SchemaSpec:\n${JSON.stringify(schemaSpec, null, 2)}\n\nCurrent RouteSet:\n${JSON.stringify(current, null, 2)}\n\nUser change request: ${prompt}\n\nReturn the full updated RouteSet JSON.`;
    const updated = await callLLMJson(provider, settings.apiKey, ROUTES_EDIT_SYSTEM, userPrompt, RouteSetSchema);
    const source = renderRouteFile(updated, schemaSpec);
    persistRoutesToDisk(jobId, updated.resource, source, JOBS_DIR);
    await completePipelineRun(run.id, { output: { routeSet: updated, edit: true } });
    return { routeSet: updated, routeSource: source };
  } catch (err) {
    await failPipelineRun(run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function getJobArtifacts(jobId: number) {
  const schemaSpec = await getLatestSchemaSpec(jobId);
  const routeSet = await getLatestRouteSet(jobId);
  const schemaSource = schemaSpec ? renderDrizzleSchema(schemaSpec) : null;
  const routeSource = (schemaSpec && routeSet) ? renderRouteFile(routeSet, schemaSpec) : null;
  const services = await db.select().from(honoServices).where(eq(honoServices.jobId, jobId)).orderBy(desc(honoServices.id));
  return { schemaSpec, routeSet, schemaSource, routeSource, honoServices: services };
}
