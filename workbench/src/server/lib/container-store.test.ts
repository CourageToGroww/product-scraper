import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db.js";
import { containers } from "../../db/schema.js";
import { insertContainer, listContainers, getContainerBySlug, updateContainerStatus } from "./container-store.js";

describe("container-store", () => {
  beforeEach(async () => {
    await db.delete(containers);
  });

  it("inserts and retrieves a container by slug", async () => {
    await insertContainer({
      slug: "job-1-test",
      name: "Job #1: test",
      type: "job-db",
      port: 5500,
      password: "p@ss",
      jobId: null,
      datasetId: null,
      dataPath: "/tmp/job-1-test"
    });

    const row = await getContainerBySlug("job-1-test");
    expect(row).toBeTruthy();
    expect(row?.type).toBe("job-db");
    expect(row?.port).toBe(5500);
    expect(row?.status).toBe("creating");
  });

  it("lists only non-destroyed containers by default", async () => {
    await insertContainer({ slug: "a", name: "a", type: "job-db", port: 5501, password: "x", jobId: null, datasetId: null, dataPath: null });
    await insertContainer({ slug: "b", name: "b", type: "job-db", port: 5502, password: "x", jobId: null, datasetId: null, dataPath: null });
    await updateContainerStatus("b", "destroyed");

    const all = await listContainers();
    expect(all.map(r => r.slug)).toEqual(["a"]);

    const including = await listContainers({ includeDestroyed: true });
    expect(including.map(r => r.slug).sort()).toEqual(["a", "b"]);
  });

  it("updates status by slug", async () => {
    await insertContainer({ slug: "c", name: "c", type: "standalone", port: 5503, password: "x", jobId: null, datasetId: null, dataPath: null });
    await updateContainerStatus("c", "running");

    const row = await getContainerBySlug("c");
    expect(row?.status).toBe("running");
  });
});
