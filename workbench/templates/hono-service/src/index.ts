import { serve } from "@hono/node-server";
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

// Auto-mount any compiled route file at /<basename>
const routesDir = path.join(__dirname, "routes");
if (fs.existsSync(routesDir)) {
  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith(".js")) continue;
    const mod = await import(path.join(routesDir, file));
    if (mod.default) {
      const name = file.replace(/\.js$/, "");
      app.route(`/${name}`, mod.default);
    }
  }
}

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Job API listening on :${info.port}`);
});
