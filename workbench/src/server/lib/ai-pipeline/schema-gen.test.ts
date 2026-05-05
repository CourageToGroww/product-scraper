import { describe, it, expect } from "vitest";
import { renderDrizzleSchema, persistSchemaToDisk } from "./schema-gen.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.NODE_ENV !== "test") {
  throw new Error("schema-gen.test.ts: refusing to run with NODE_ENV != 'test'");
}

describe("renderDrizzleSchema", () => {
  it("renders a simple table with mixed column types", () => {
    const out = renderDrizzleSchema({
      tables: [{
        name: "products",
        primaryKey: "id",
        columns: [
          { name: "title", type: "text", nullable: false },
          { name: "price", type: "real", nullable: true },
          { name: "in_stock", type: "boolean", nullable: false }
        ]
      }]
    });
    expect(out).toContain(`pgTable("products"`);
    expect(out).toContain(`title: text("title").notNull(),`);
    expect(out).toContain(`price: real("price"),`);
    expect(out).toContain(`inStock: boolean("in_stock").notNull(),`);
    expect(out).toContain(`createSelectSchema(products)`);
  });

  it("converts snake_case column names to camelCase identifiers", () => {
    const out = renderDrizzleSchema({
      tables: [{
        name: "scrape_results",
        primaryKey: "id",
        columns: [{ name: "raw_html", type: "text", nullable: true }]
      }]
    });
    expect(out).toContain(`scrapeResults`);
    expect(out).toContain(`rawHtml: text("raw_html"),`);
  });
});

describe("persistSchemaToDisk", () => {
  it("writes schema.ts under jobs/<jobId>/", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "schemagen-"));
    const result = persistSchemaToDisk(42, {
      tables: [{ name: "items", primaryKey: "id", columns: [{ name: "n", type: "integer", nullable: false }] }]
    }, tmp);
    expect(result.filePath).toBe(path.join(tmp, "42", "schema.ts"));
    expect(fs.readFileSync(result.filePath, "utf-8")).toContain(`pgTable("items"`);
  });
});
