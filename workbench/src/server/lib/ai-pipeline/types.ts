import { z } from "zod";

// ── Phase identifier ────────────────────────────────────────────────

export const PhaseSchema = z.enum(["schema", "data", "api"]);
export type Phase = z.infer<typeof PhaseSchema>;

// ── Phase 1 output: schema spec ─────────────────────────────────────

export const ColumnTypeSchema = z.enum([
  "text", "integer", "real", "boolean", "timestamp", "jsonb"
]);
export type ColumnType = z.infer<typeof ColumnTypeSchema>;

export const ColumnSpecSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case identifier"),
  type: ColumnTypeSchema,
  nullable: z.boolean().default(true),
  description: z.string().optional()
});
export type ColumnSpec = z.infer<typeof ColumnSpecSchema>;

export const TableSpecSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case identifier"),
  columns: z.array(ColumnSpecSchema).min(1),
  primaryKey: z.string().default("id")
});
export type TableSpec = z.infer<typeof TableSpecSchema>;

export const SchemaSpecSchema = z.object({
  tables: z.array(TableSpecSchema).min(1)
});
export type SchemaSpec = z.infer<typeof SchemaSpecSchema>;

// ── Phase 2 output: data summary ────────────────────────────────────

export const DataResultSchema = z.object({
  datasetId: z.number(),
  rowCount: z.number(),
  durationMs: z.number()
});
export type DataResult = z.infer<typeof DataResultSchema>;

// ── Phase 3 output: route spec ──────────────────────────────────────

export const RouteSpecSchema = z.object({
  method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
  path: z.string().regex(/^\/[a-z0-9_\-/:]*$/),
  description: z.string(),
  /** TypeScript source code for the Hono handler body */
  handlerSource: z.string()
});
export type RouteSpec = z.infer<typeof RouteSpecSchema>;

export const RouteSetSchema = z.object({
  resource: z.string().regex(/^[a-z][a-z0-9_]*$/),
  routes: z.array(RouteSpecSchema).min(1)
});
export type RouteSet = z.infer<typeof RouteSetSchema>;

// ── Pipeline run summary ────────────────────────────────────────────

export interface PipelineRun {
  jobId: number;
  schemaPipelineId?: number;
  dataPipelineId?: number;
  apiPipelineId?: number;
  honoServiceId?: number;
}
