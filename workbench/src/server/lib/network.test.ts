import { describe, it, expect, afterAll } from "vitest";
import Docker from "dockerode";
import { ensureNetwork, networkExists, NETWORK_NAME } from "./network.js";

const docker = new Docker();
const dockerAvailable = await docker.ping().then(() => true).catch(() => false);

describe("ensureNetwork", () => {
  afterAll(async () => {
    if (!dockerAvailable) return;
    try {
      await docker.getNetwork(NETWORK_NAME).remove();
    } catch { /* may already be gone */ }
  });

  it.skipIf(!dockerAvailable)("creates the network when missing", async () => {
    try {
      await docker.getNetwork(NETWORK_NAME).remove();
    } catch { /* ok */ }

    await ensureNetwork();

    const list = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
    expect(list.some(n => n.Name === NETWORK_NAME)).toBe(true);
  });

  it.skipIf(!dockerAvailable)("is idempotent when network already exists", async () => {
    await ensureNetwork();
    await ensureNetwork();

    const list = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
    const matches = list.filter(n => n.Name === NETWORK_NAME);
    expect(matches.length).toBe(1);
  });

  it.skipIf(!dockerAvailable)("networkExists returns true after ensureNetwork", async () => {
    await ensureNetwork();
    expect(await networkExists()).toBe(true);
  });
});
