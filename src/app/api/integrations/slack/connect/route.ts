import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto/secret-box";
import { getMyRole, getWorkspace } from "@/lib/data/workspaces";
import { SLACK_STATE_COOKIE, SLACK_STATE_COOKIE_PATH, newOAuthState } from "@/lib/integrations/oauth-state";
import { slackAppConfig, slackAuthorizeUrl, slackRedirectUri } from "@/lib/integrations/slack-oauth";
import { siteUrl } from "@/lib/urls";

// Starts "Add to Slack" for one Dossify workspace: /api/integrations/slack/connect?workspace=<id>
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const workspaceId = request.nextUrl.searchParams.get("workspace") ?? "";

  const user = await getCurrentUser();
  if (!user) {
    const next = `/api/integrations/slack/connect?workspace=${encodeURIComponent(workspaceId)}`;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, origin));
  }

  // RLS-scoped: null unless the user belongs to this workspace.
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return NextResponse.redirect(new URL("/dashboard", origin));

  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/w/${workspace.id}/settings?slack=error&reason=${reason}`, origin));

  const role = await getMyRole(workspace.organization.id, user.id);
  if (role !== "owner" && role !== "admin") return back("not_admin");

  const app = slackAppConfig();
  if (!app || !hasEncryptionKey()) return back("not_configured");

  const { state, cookie } = newOAuthState(workspace.id);
  const response = NextResponse.redirect(
    slackAuthorizeUrl({ clientId: app.clientId, redirectUri: slackRedirectUri(await siteUrl()), state }),
  );
  response.cookies.set(SLACK_STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on Slack's top-level redirect back to us
    path: SLACK_STATE_COOKIE_PATH,
    maxAge: 10 * 60,
  });
  return response;
}
