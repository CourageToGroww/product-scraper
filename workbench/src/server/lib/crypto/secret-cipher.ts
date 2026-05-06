import crypto from "node:crypto";

const ENV_KEY = process.env.SCRAPEKIT_KEY_ENCRYPTION_KEY;
// Derive a stable per-machine fallback so existing dev DBs keep working without manual setup.
// Production deployments should set SCRAPEKIT_KEY_ENCRYPTION_KEY explicitly.
const FALLBACK_KEY = crypto.createHash("sha256").update("scrapekit-dev-fallback-do-not-use-in-prod").digest();
const KEY = ENV_KEY ? Buffer.from(ENV_KEY, "base64") : FALLBACK_KEY;
if (KEY.length !== 32) {
  throw new Error("SCRAPEKIT_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key (AES-256)");
}

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "enc1:"; // versioned scheme

export function encryptSecret(plaintext: string | null): string | null {
  if (plaintext === null) return null;
  if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted, pass through
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(value: string | null): string | null {
  if (value === null) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext, return as-is for compatibility
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALG, KEY, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  return pt;
}
