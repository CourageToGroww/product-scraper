import type { Context, Next } from "hono";
import { z } from "zod";

export type Env = {
  Variables: {
    validatedBody: unknown;
    validatedQuery: unknown;
  };
};

export function validateBody<T extends z.ZodType>(schema: T) {
  return async (c: Context<Env>, next: Next) => {
    const body = await c.req.json().catch(() => null);
    if (body === null) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json({
        error: "Validation failed",
        details: result.error.issues.map(i => ({
          path: i.path.join("."),
          message: i.message
        }))
      }, 400);
    }
    c.set("validatedBody", result.data);
    return next();
  };
}

export function validateQuery<T extends z.ZodType>(schema: T) {
  return async (c: Context<Env>, next: Next) => {
    const query = c.req.query();
    const result = schema.safeParse(query);
    if (!result.success) {
      return c.json({
        error: "Invalid query parameters",
        details: result.error.issues.map(i => ({
          path: i.path.join("."),
          message: i.message
        }))
      }, 400);
    }
    c.set("validatedQuery", result.data);
    return next();
  };
}
