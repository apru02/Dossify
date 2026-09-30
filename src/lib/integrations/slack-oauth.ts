import "server-only";
import { z } from "zod";

// "Add to Slack" (OAuth v2, scope incoming-webhook). One Slack app for the whole deployment;
// each installation yields a webhook for the channel the installing user picks.
// Docs: https://api.slack.com/authentication/oauth-v2 and https://api.slack.com/messaging/webhooks

export const SLACK_SCOPES = "incoming-webhook";

export function slackAppConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function slackRedirectUri(siteUrl: string): string {
  return `${siteUrl}/api/integrations/slack/callback`;
}

export function slackAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("scope", SLACK_SCOPES);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

const accessResponse = z.object({
  ok: z.literal(true),
  access_token: z.string().optional(),
  team: z.object({ id: z.string(), name: z.string() }).partial().optional(),
  incoming_webhook: z.object({
    url: z.string(),
    channel: z.string().optional(),
    channel_id: z.string().optional(),
    configuration_url: z.string().optional(),
  }),
});

export type SlackInstallation = z.infer<typeof accessResponse>;

export class SlackOAuthError extends Error {}

export async function exchangeSlackCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<SlackInstallation> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ code: opts.code, redirect_uri: opts.redirectUri }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!json?.ok) throw new SlackOAuthError(json?.error ?? `http_${res.status}`);
  const parsed = accessResponse.safeParse(json);
  if (!parsed.success) throw new SlackOAuthError("unexpected_response");
  return parsed.data;
}

// Best-effort uninstall when a workspace disconnects Slack.
export async function revokeSlackToken(token: string): Promise<void> {
  await fetch("https://slack.com/api/auth.revoke", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}
