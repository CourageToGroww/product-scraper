import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import scrapeRoutes from "./routes/scrapes.js";
import datasetRoutes from "./routes/datasets.js";
import dashboardRoutes from "./routes/dashboards.js";
import databaseRoutes from "./routes/databases.js";
import extractRoutes from "./routes/extract.js";
import imageRoutes from "./routes/images.js";
import settingsRoutes from "./routes/settings.js";
import { execSync } from "node:child_process";
import { errorHandler } from "./middleware/error-handler.js";
import { env } from "./lib/env.js";

const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", cors({
  origin: ["http://localhost:3000", "http://localhost:5173"],
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
  allowHeaders: ["Content-Type"]
}));

// API routes
app.route("/api/scrapes", scrapeRoutes);
app.route("/api/datasets", datasetRoutes);
app.route("/api/dashboards", dashboardRoutes);
app.route("/api/databases", databaseRoutes);
app.route("/api/extract", extractRoutes);
app.route("/api/images", imageRoutes);
app.route("/api/settings", settingsRoutes);

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// App config (studio URL etc.)
let _cachedStudioPort: number | null | undefined;

function detectStudioPort(): number | null {
  if (_cachedStudioPort !== undefined) return _cachedStudioPort;

  // Prefer env var
  if (env.STUDIO_PORT) {
    _cachedStudioPort = env.STUDIO_PORT;
    return _cachedStudioPort;
  }

  // Auto-detect from running drizzle-kit studio processes
  try {
    const output = execSync("ps aux", { encoding: "utf-8", timeout: 3000 });
    const line = output.split("\n").find(
      l => l.includes("drizzle-kit") && l.includes("studio") && l.includes("workbench")
    );
    if (line) {
      const match = line.match(/--port\s+(\d+)/);
      if (match) {
        _cachedStudioPort = parseInt(match[1]);
        return _cachedStudioPort;
      }
    }
  } catch { /* ignore */ }

  _cachedStudioPort = null;
  return null;
}

app.get("/api/config", (c) => {
  const port = detectStudioPort();
  return c.json({
    studioUrl: port ? `https://local.drizzle.studio/?port=${port}` : null
  });
});

// Serve static frontend (production build)
app.use("/*", serveStatic({ root: "./dist/client" }));

// SPA fallback
app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));

// Error handler
app.onError(errorHandler);

export default app;
