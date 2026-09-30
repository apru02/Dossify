import { createHash, randomBytes } from "node:crypto";

// Invitation tokens: 256 random bits in the link; only the SHA-256 hash is stored, so a database
// read never yields a usable link.
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url"); // 43 chars
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const inviteLink = (siteUrl: string, token: string) => `${siteUrl}/invite/${token}`;
