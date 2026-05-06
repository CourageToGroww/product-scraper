CREATE TABLE "merges" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_dataset_ids" jsonb NOT NULL,
	"target_container_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"row_counts" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merges" ADD CONSTRAINT "merges_target_container_id_containers_id_fk" FOREIGN KEY ("target_container_id") REFERENCES "public"."containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merges_status_idx" ON "merges" USING btree ("status");