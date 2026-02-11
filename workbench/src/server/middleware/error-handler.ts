import type { Context } from "hono";

export function errorHandler(err: Error, c: Context) {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);

  if (err.message.includes("not found") || err.message.includes("Not found")) {
    return c.json({ error: "Resource not found" }, 404);
  }

  return c.json({ error: "Internal server error" }, 500);
}
