import Docker from "dockerode";

export const NETWORK_NAME = "scrapekit-net";
const NETWORK_DRIVER = "bridge";

const docker = new Docker();

export async function ensureNetwork(): Promise<void> {
  const existing = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
  if (existing.some(n => n.Name === NETWORK_NAME)) return;

  try {
    await docker.createNetwork({
      Name: NETWORK_NAME,
      Driver: NETWORK_DRIVER,
      CheckDuplicate: true,
      Labels: { "com.scrapekit.managed": "true" }
    });
  } catch (err: unknown) {
    // Concurrent caller won the race; network now exists — not an error.
    if (err instanceof Error && /already exists/i.test(err.message)) return;
    throw err;
  }
}

export async function networkExists(): Promise<boolean> {
  const list = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
  return list.some(n => n.Name === NETWORK_NAME);
}
