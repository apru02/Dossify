import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMyRole, getWorkspace } from "@/lib/data/workspaces";
import { SLACK_STATE_COOKIE, SLACK_STATE_COOKIE_PATH, verifyOAuthState } from "@/lib/integrations/oauth-state";
import { SlackOAuthError, exchangeSlackCode, slackAppConfig, slackRedirectUri } from "@/lib/integrations/slack-oauth";
import { saveSlackConnection } from "@/lib/integrations/store";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/urls";

// Slack redirects here after the user approves (or cancels) "Add to Slack".
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const workspaceId = verifyOAuthState(request.cookies.get(SLACK_STATE_COOKIE)?.value, searchParams.get("state"));

  const done = (path: string) => {
    const res = NextResponse.redirect(new URL(path, origin));
    res.cookies.set(SLACK_STATE_COOKIE, "", { path: SLACK_STATE_COOKIE_PATH, maxAge: 0 }); // one-time use
    return res;
  };

  // Missing/forged state: don't touch anything (CSRF protection).
  if (!workspaceId) return done("/dashboard");
  const settings = (query: string) => done(`/w/${workspaceId}/settings?${query}`);

  if (searchParams.get("error")) return settings("slack=cancelled");
  const code = searchParams.get("code");
  if (!code) return settings("slack=error&reason=missing_code");

  const user = await getCurrentUser();
  if (!user) return done("/login");
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return done("/dashboard");
  const role = await getMyRole(workspace.organization.id, user.id);
  if (role !== "owner" && role !== "admin") return settings("slack=error&reason=not_admin");

  const app = slackAppConfig();
  if (!app) return settings("slack=error&reason=not_configured");

  try {
    const install = await exchangeSlackCode({ ...app, code, redirectUri: slackRedirectUri(await siteUrl()) });
    await saveSlackConnection(await createClient(), workspace.id, install);
  } catch (e) {
    const reason = e instanceof SlackOAuthError ? e.message.replace(/[^\w]/g, "").slice(0, 40) : "save_failed";
    console.error("Slack connect failed", { workspaceId: workspace.id, reason, message: (e as Error)?.message });
    return settings(`slack=error&reason=${reason}`);
  }
  return settings("slack=connected");
}
