import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().default("postgres://scrapekit:scrapekit@localhost:5432/scrapekit"),
  PORT: z.coerce.number().int().positive().default(3000),
  STUDIO_PORT: z.coerce.number().int().positive().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development")
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
