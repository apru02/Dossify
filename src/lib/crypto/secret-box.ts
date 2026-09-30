import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Authenticated encryption for secrets stored in the database (integration webhooks / tokens).
// AES-256-GCM with a random 96-bit IV. `context` (e.g. the workspace id) is bound as associated
// data, so a ciphertext copied into another workspace's row fails to decrypt.
// Format: "v1:" + base64(iv | authTag | ciphertext)

const VERSION = "v1:";

function key(): Buffer {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw) throw new Error("INTEGRATIONS_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function hasEncryptionKey(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function seal(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function open(sealed: string, context: string): string {
  if (!sealed.startsWith(VERSION)) throw new Error("Unknown secret format");
  const raw = Buffer.from(sealed.slice(VERSION.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"); // throws if tampered
}
