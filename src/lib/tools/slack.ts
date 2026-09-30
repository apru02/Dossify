// Slack message formatting and delivery via an incoming-webhook URL. Webhook URLs are secrets:
// they come decrypted from the workspace's integration, are never logged, and never reach the
// model or the browser.
import { ToolError } from "./types";

const SLACK_WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/;

export const isSlackWebhookUrl = (url: string) => SLACK_WEBHOOK_RE.test(url);

// Slack treats <...> as control sequences: <!channel>, <!here>, <@U123>, <https://evil|click me>.
// Escaping & < > makes model/document-supplied text inert, so a prompt-injected summary can't ping
// the whole channel or smuggle in a disguised link.
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Light Markdown → Slack mrkdwn (the model writes Markdown).
export function toSlackMrkdwn(markdown: string): string {
  return escapeSlack(markdown)
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

export type SlackMessage = { title: string; text: string; sharedBy: string; workspaceName: string };

export function slackPayload(msg: SlackMessage) {
  const title = msg.title.slice(0, 150);
  const body = toSlackMrkdwn(msg.text).slice(0, 2900);
  return {
    // Notification fallback. Slack parses mentions here too, so it must be escaped like the blocks.
    text: escapeSlack(`${title}: ${msg.text.slice(0, 200)}`),
    blocks: [
      { type: "header", text: { type: "plain_text", text: title, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: body } },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Shared by ${escapeSlack(msg.sharedBy)} from *${escapeSlack(msg.workspaceName)}* via Dossify` },
        ],
      },
    ],
  };
}

export async function postToSlackWebhook(webhookUrl: string, msg: SlackMessage): Promise<void> {
  if (!isSlackWebhookUrl(webhookUrl)) throw new ToolError("The saved Slack connection is invalid. Reconnect Slack in Settings.");

  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload(msg)),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ToolError("Couldn't reach Slack. Try again in a moment.");
  }
  if (!res.ok) {
    // Slack returns short codes like "invalid_token", "no_service" or "channel_is_archived".
    const code = (await res.text().catch(() => "")).slice(0, 60).replace(/[^\w -]/g, "");
    const hint = res.status === 404 || res.status === 410 || code === "no_service" ? " Reconnect Slack in Settings." : "";
    throw new ToolError(`Slack rejected the message (${res.status}${code ? `: ${code}` : ""}).${hint}`);
  }
}
