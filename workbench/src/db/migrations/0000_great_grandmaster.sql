CREATE TABLE "ai_pipelines" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"phase" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_summary" jsonb,
	"output" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charts" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"name" text NOT NULL,
	"chart_type" text NOT NULL,
	"dataset_id" integer,
	"config" jsonb NOT NULL,
	"position" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"job_id" integer,
	"dataset_id" integer,
	"container_id" text,
	"port" integer NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"password" text NOT NULL,
	"db_user" text DEFAULT 'scrapekit' NOT NULL,
	"db_name" text DEFAULT 'scrapekit' NOT NULL,
	"data_path" text,
	"network" text DEFAULT 'scrapekit-net' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"destroyed_at" timestamp,
	CONSTRAINT "containers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"layout" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"row_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_job_id" integer,
	"schema" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"database_port" integer,
	"database_container_id" text,
	"database_status" text DEFAULT 'none' NOT NULL,
	"extraction_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hono_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"container_ref" integer,
	"src_dir" text NOT NULL,
	"image_tag" text,
	"port" integer NOT NULL,
	"status" text DEFAULT 'scaffolded' NOT NULL,
	"routes_generated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"urls" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"progress" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	"result_summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"url" text NOT NULL,
	"status" integer,
	"original_status" integer,
	"timing" integer,
	"response_type" text,
	"extracted_data" jsonb,
	"autoparse_data" jsonb,
	"network_requests" jsonb,
	"converted_content" text,
	"raw_html" text,
	"screenshot_base64" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"ai_provider" text,
	"ai_autoparse" boolean DEFAULT false NOT NULL,
	"ai_parse_mode" text DEFAULT 'general' NOT NULL,
	"claude_api_key" text,
	"openai_api_key" text,
	"gemini_api_key" text,
	"deepseek_api_key" text,
	"kimi_api_key" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_pipelines" ADD CONSTRAINT "ai_pipelines_job_id_scrape_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scrape_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_job_id_scrape_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scrape_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_source_job_id_scrape_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."scrape_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hono_services" ADD CONSTRAINT "hono_services_job_id_scrape_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scrape_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hono_services" ADD CONSTRAINT "hono_services_container_ref_containers_id_fk" FOREIGN KEY ("container_ref") REFERENCES "public"."containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_results" ADD CONSTRAINT "scrape_results_job_id_scrape_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scrape_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_pipelines_job_idx" ON "ai_pipelines" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ai_pipelines_status_idx" ON "ai_pipelines" USING btree ("status");--> statement-breakpoint
CREATE INDEX "charts_dashboard_idx" ON "charts" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "containers_type_idx" ON "containers" USING btree ("type");--> statement-breakpoint
CREATE INDEX "containers_status_idx" ON "containers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "containers_job_idx" ON "containers" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "containers_dataset_idx" ON "containers" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "dataset_rows_dataset_idx" ON "dataset_rows" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "dataset_rows_index_idx" ON "dataset_rows" USING btree ("dataset_id","row_index");--> statement-breakpoint
CREATE INDEX "hono_services_job_idx" ON "hono_services" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "scrape_jobs_status_idx" ON "scrape_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scrape_jobs_created_idx" ON "scrape_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scrape_results_job_idx" ON "scrape_results" USING btree ("job_id");