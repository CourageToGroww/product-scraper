import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./lib/env.js";
import { migrateRegistryIfNeeded } from "./lib/registry-migrate.js";

// Keep the server alive when async background work (e.g. dockerode HTTP calls,
// stale registry inspect-fallbacks) emits unhandled errors after a request returns.
// Log loudly so we still notice problems, but do not exit.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] keeping server alive:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] keeping server alive:", reason);
});

async function main() {
  const result = await migrateRegistryIfNeeded();
  if (!result.skipped) {
    console.log(`  Registry migration: ${result.migrated} containers imported from registry.json`);
  }

  console.log(`
  ScrapeKit Workbench
  -------------------
  Port:     ${env.PORT}
  Database: ${env.DATABASE_URL.replace(/\/\/.*@/, "//***@")}
  Mode:     ${env.NODE_ENV}
`);

  serve({
    fetch: app.fetch,
    port: env.PORT
  }, (info) => {
    console.log(`  Server running at http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
