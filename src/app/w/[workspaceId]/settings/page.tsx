import type { Metadata } from "next";
import { CheckCircle2, ExternalLink, Info, XCircle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SlackIcon } from "@/components/brand/slack-icon";
import { requireUser } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto/secret-box";
import { getMyRole, getWorkspace, listMembers } from "@/lib/data/workspaces";
import { slackAppConfig } from "@/lib/integrations/slack-oauth";
import { getSlackConnection } from "@/lib/integrations/store";
import { createClient } from "@/lib/supabase/server";
import { SlackConnectedActions } from "./slack-buttons";

export const metadata: Metadata = { title: "Settings" };

const SLACK_ERRORS: Record<string, string> = {
  not_admin: "Only workspace owners and admins can connect Slack.",
  not_configured: "Slack isn't set up on this Dossify deployment yet (missing Slack app credentials or encryption key).",
  missing_code: "Slack didn't return an authorization code. Please try again.",
  invalid_code: "That Slack authorization expired. Please try again.",
  bad_redirect_uri: "The Slack app's redirect URL doesn't match this site. Check the Slack app settings.",
  save_failed: "Connected to Slack, but saving the connection failed. Please try again.",
};

export default async function SettingsPage({ params, searchParams }: PageProps<"/w/[workspaceId]/settings">) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing
  const [role, slack] = await Promise.all([
    getMyRole(workspace.organization.id, user.id),
    getSlackConnection(await createClient(), workspace.id),
  ]);
  const isAdmin = role === "owner" || role === "admin";
  const slackAvailable = Boolean(slackAppConfig()) && hasEncryptionKey();

  let connectedByName: string | null = null;
  if (slack?.connectedBy) {
    connectedByName =
      slack.connectedBy === user.id
        ? "you"
        : ((await listMembers(workspace.organization.id)).find((m) => m.userId === slack.connectedBy)?.fullName ?? "a teammate");
  }

  const banner =
    sp.slack === "connected"
      ? { ok: true, text: "Slack connected. Try “Send a summary of … to Slack” in chat." }
      : sp.slack === "cancelled"
        ? { ok: false, text: "Slack connection was cancelled." }
        : sp.slack === "error"
          ? { ok: false, text: SLACK_ERRORS[String(sp.reason)] ?? "Couldn't connect Slack. Please try again." }
          : null;

  return (
    <>
      <PageHeader title="Settings" description={`Integrations for the ${workspace.name} workspace.`} />
      <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-10">
        {banner && (
          <p
            role="status"
            className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${banner.ok ? "border-success/20 bg-success/5 text-success" : "border-danger/20 bg-danger/5 text-danger"}`}
          >
            {banner.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
            {banner.text}
          </p>
        )}

        <section className="rounded-3xl border border-line bg-white p-6 shadow-card">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Integrations</h2>

          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-line bg-white">
              <SlackIcon className="size-6" />
            </span>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h3 className="font-semibold">Slack</h3>
                <p className="mt-0.5 text-sm text-muted">
                  Lets the assistant post summaries to a channel you choose when someone in {workspace.name} asks it to.
                  Each workspace connects its own channel.
                </p>
              </div>

              {slack ? (
                <>
                  <div className="rounded-2xl bg-canvas px-4 py-3 text-sm">
                    <p className="flex items-center gap-1.5 font-medium text-success">
                      <CheckCircle2 className="size-4" aria-hidden /> Connected
                    </p>
                    <p className="mt-1 text-ink">
                      Posting to <span className="font-semibold">{slack.channelName ?? "a channel"}</span>
                      {slack.teamName && (
                        <>
                          {" "}
                          in <span className="font-semibold">{slack.teamName}</span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Connected {connectedByName && `by ${connectedByName} `}on{" "}
                      {new Date(slack.connectedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                      {slack.configurationUrl && (
                        <>
                          {" · "}
                          <a href={slack.configurationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                            Manage in Slack <ExternalLink className="size-3" aria-hidden />
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  {isAdmin ? (
                    <SlackConnectedActions workspaceId={workspace.id} />
                  ) : (
                    <p className="text-xs text-muted">Only workspace owners and admins can change this.</p>
                  )}
                </>
              ) : !slackAvailable ? (
                <p className="flex items-start gap-2 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Slack isn&apos;t available on this Dossify deployment yet.
                </p>
              ) : isAdmin ? (
                <a
                  href={`/api/integrations/slack/connect?workspace=${workspace.id}`}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-semibold shadow-sm hover:bg-canvas"
                >
                  <SlackIcon className="size-4" /> Add to Slack
                </a>
              ) : (
                <p className="text-sm text-muted">Ask a workspace owner or admin to connect Slack.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
