import { pgTable, text, integer, timestamp, jsonb, serial, index, boolean } from "drizzle-orm/pg-core";

export const scrapeJobs = pgTable("scrape_jobs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).notNull().default("pending"),
  urls: jsonb("urls").notNull().$type<string[]>(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  progress: jsonb("progress").$type<{ completed: number; total: number; currentUrl?: string }>(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => [
  index("scrape_jobs_status_idx").on(table.status),
  index("scrape_jobs_created_idx").on(table.createdAt)
]);

export const scrapeResults = pgTable("scrape_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => scrapeJobs.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: integer("status"),
  originalStatus: integer("original_status"),
  timing: integer("timing"),
  responseType: text("response_type"),
  extractedData: jsonb("extracted_data").$type<Record<string, unknown>>(),
  autoparseData: jsonb("autoparse_data").$type<Record<string, unknown>>(),
  networkRequests: jsonb("network_requests").$type<unknown[]>(),
  convertedContent: text("converted_content"),
  rawHtml: text("raw_html"),
  screenshotBase64: text("screenshot_base64"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => [
  index("scrape_results_job_idx").on(table.jobId)
]);

export const datasets = pgTable("datasets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sourceJobId: integer("source_job_id").references(() => scrapeJobs.id, { onDelete: "set null" }),
  schema: jsonb("schema").$type<Record<string, string>>(),
  rowCount: integer("row_count").notNull().default(0),
  databasePort: integer("database_port"),
  databaseContainerId: text("database_container_id"),
  databaseStatus: text("database_status", { enum: ["none", "creating", "running", "stopped", "error"] }).notNull().default("none"),
  extractionConfig: jsonb("extraction_config").$type<{ mode: string; config: Record<string, unknown> }>(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const datasetRows = pgTable("dataset_rows", {
  id: serial("id").primaryKey(),
  datasetId: integer("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  rowIndex: integer("row_index").notNull()
}, (table) => [
  index("dataset_rows_dataset_idx").on(table.datasetId),
  index("dataset_rows_index_idx").on(table.datasetId, table.rowIndex)
]);

export const dashboards = pgTable("dashboards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  layout: jsonb("layout").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const charts = pgTable("charts", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  chartType: text("chart_type", { enum: ["bar", "line", "pie", "scatter", "area", "stat", "table"] }).notNull(),
  datasetId: integer("dataset_id").references(() => datasets.id, { onDelete: "set null" }),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  position: jsonb("position").notNull().$type<{ x: number; y: number; w: number; h: number }>(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => [
  index("charts_dashboard_idx").on(table.dashboardId)
]);

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  aiProvider: text("ai_provider", {
    enum: ["claude", "openai", "gemini", "deepseek", "kimi"]
  }),
  aiAutoparse: boolean("ai_autoparse").notNull().default(false),
  aiParseMode: text("ai_parse_mode", {
    enum: ["general", "ecommerce", "articles", "contacts", "real_estate", "jobs"]
  }).notNull().default("general"),
  claudeApiKey: text("claude_api_key"),
  openaiApiKey: text("openai_api_key"),
  geminiApiKey: text("gemini_api_key"),
  deepseekApiKey: text("deepseek_api_key"),
  kimiApiKey: text("kimi_api_key"),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

export const containers = pgTable("containers", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: ["job-db", "job-api", "dataset-db", "standalone", "merge-target", "main-db"] }).notNull(),
  jobId: integer("job_id").references(() => scrapeJobs.id, { onDelete: "set null" }),
  datasetId: integer("dataset_id").references(() => datasets.id, { onDelete: "set null" }),
  containerId: text("container_id"),
  port: integer("port").notNull(),
  status: text("status", { enum: ["creating", "running", "stopped", "error", "destroyed"] }).notNull().default("creating"),
  password: text("password").notNull(),
  dbUser: text("db_user").notNull().default("scrapekit"),
  dbName: text("db_name").notNull().default("scrapekit"),
  dataPath: text("data_path"),
  network: text("network").notNull().default("scrapekit-net"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  destroyedAt: timestamp("destroyed_at")
}, (table) => [
  index("containers_type_idx").on(table.type),
  index("containers_status_idx").on(table.status),
  index("containers_job_idx").on(table.jobId),
  index("containers_dataset_idx").on(table.datasetId)
]);

export const aiPipelines = pgTable("ai_pipelines", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => scrapeJobs.id, { onDelete: "cascade" }),
  phase: text("phase", { enum: ["schema", "data", "api"] }).notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).notNull().default("pending"),
  inputSummary: jsonb("input_summary").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => [
  index("ai_pipelines_job_idx").on(table.jobId),
  index("ai_pipelines_status_idx").on(table.status)
]);

export const honoServices = pgTable("hono_services", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => scrapeJobs.id, { onDelete: "cascade" }),
  containerRef: integer("container_ref").references(() => containers.id, { onDelete: "set null" }),
  srcDir: text("src_dir").notNull(),
  imageTag: text("image_tag"),
  port: integer("port").notNull(),
  status: text("status", { enum: ["scaffolded", "building", "running", "stopped", "error"] }).notNull().default("scaffolded"),
  routesGenerated: integer("routes_generated").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => [
  index("hono_services_job_idx").on(table.jobId)
]);
