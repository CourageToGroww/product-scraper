import { describe, it, expect } from "vitest";
import { renderRouteFile } from "./route-gen.js";

if (process.env.NODE_ENV !== "test") {
  throw new Error("route-gen.test.ts: refusing to run with NODE_ENV != 'test'");
}

describe("renderRouteFile", () => {
  it("emits a Hono app with the requested routes", () => {
    const out = renderRouteFile(
      {
        resource: "products",
        routes: [{
          method: "GET",
          path: "/",
          description: "List all products",
          handlerSource: `const rows = await db.select().from(products);\nreturn c.json(rows);`
        }]
      },
      {
        tables: [{ name: "products", primaryKey: "id", columns: [{ name: "title", type: "text", nullable: false }] }]
      }
    );
    expect(out).toContain(`new Hono()`);
    expect(out).toContain(`app.get("/", async`);
    expect(out).toContain(`db.select().from(products)`);
    expect(out).toContain(`export default app;`);
  });
});
