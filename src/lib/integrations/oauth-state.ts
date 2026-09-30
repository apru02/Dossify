import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";

// CSRF protection for the Slack OAuth round-trip: a random nonce travels as `state` and is also
// kept in an httpOnly cookie bound to the workspace being connected. The callback accepts the
// code only if both match.

export const SLACK_STATE_COOKIE = "dossify_slack_oauth";
export const SLACK_STATE_COOKIE_PATH = "/api/integrations/slack";

export function newOAuthState(workspaceId: string) {
  const nonce = randomBytes(24).toString("hex");
  return { state: nonce, cookie: `${nonce}.${workspaceId}` };
}

// Returns the workspace id the flow was started for, or null if the state doesn't match.
export function verifyOAuthState(cookie: string | undefined, state: string | null): string | null {
  if (!cookie || !state) return null;
  const [nonce, workspaceId] = cookie.split(".");
  if (!nonce || !workspaceId) return null;
  const a = Buffer.from(nonce);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b) ? workspaceId : null;
}
