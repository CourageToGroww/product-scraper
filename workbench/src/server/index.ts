import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./lib/env.js";

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
