import { describe, it, expect, afterAll } from "vitest";
import Docker from "dockerode";
import { ensureNetwork, NETWORK_NAME } from "./network.js";

const docker = new Docker();

describe("ensureNetwork", () => {
  afterAll(async () => {
    try {
      const net = docker.getNetwork(NETWORK_NAME);
      await net.remove();
    } catch { /* may already be gone */ }
  });

  it("creates the network when missing", async () => {
    try {
      await docker.getNetwork(NETWORK_NAME).remove();
    } catch { /* ok */ }

    await ensureNetwork();

    const list = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
    expect(list.some(n => n.Name === NETWORK_NAME)).toBe(true);
  });

  it("is idempotent when network already exists", async () => {
    await ensureNetwork();
    await ensureNetwork(); // second call must not throw

    const list = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
    const matches = list.filter(n => n.Name === NETWORK_NAME);
    expect(matches.length).toBe(1);
  });
});
