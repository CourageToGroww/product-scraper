import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://scrapekit:scrapekit@localhost:5434/scrapekit"
    }
  }
});
