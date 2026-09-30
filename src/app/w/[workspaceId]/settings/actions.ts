"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { displayName, requireUser } from "@/lib/auth";
import { getMyRole, getWorkspace } from "@/lib/data/workspaces";
import { revokeSlackToken } from "@/lib/integrations/slack-oauth";
import { deleteSlackConnection, getSlackWebhook } from "@/lib/integrations/store";
import { createClient } from "@/lib/supabase/server";
import { postToSlackWebhook } from "@/lib/tools/slack";
import { ToolError } from "@/lib/tools/types";

export type SettingsActionResult = { ok: boolean; message: string };

async function adminWorkspace(workspaceId: unknown) {
  const user = await requireUser();
  const id = z.uuid().safeParse(workspaceId);
  if (!id.success) return null;
  const workspace = await getWorkspace(id.data);
  if (!workspace) return null;
  const role = await getMyRole(workspace.organization.id, user.id);
  return role === "owner" || role === "admin" ? { user, workspace } : null;
}

export async function disconnectSlack(workspaceId: string): Promise<SettingsActionResult> {
  const ctx = await adminWorkspace(workspaceId);
  if (!ctx) return { ok: false, message: "Only workspace admins can manage integrations." };

  try {
    const { deleted, accessToken } = await deleteSlackConnection(await createClient(), ctx.workspace.id);
    if (!deleted) return { ok: false, message: "Slack wasn't connected." };
    if (accessToken) await revokeSlackToken(accessToken); // best-effort uninstall on Slack's side
  } catch (e) {
    console.error("disconnectSlack failed", (e as Error)?.message);
    return { ok: false, message: "Couldn't disconnect Slack. Try again." };
  }
  revalidatePath(`/w/${ctx.workspace.id}/settings`);
  return { ok: true, message: "Slack disconnected." };
}

export async function sendSlackTestMessage(workspaceId: string): Promise<SettingsActionResult> {
  const ctx = await adminWorkspace(workspaceId);
  if (!ctx) return { ok: false, message: "Only workspace admins can manage integrations." };

  try {
    const webhook = await getSlackWebhook(await createClient(), ctx.workspace.id);
    if (!webhook) return { ok: false, message: "Slack isn't connected." };
    await postToSlackWebhook(webhook, {
      title: "Dossify is connected",
      text: `Summaries from the *${ctx.workspace.name}* workspace will be posted to this channel when someone asks Dossify to share them.`,
      sharedBy: displayName(ctx.user),
      workspaceName: ctx.workspace.name,
    });
    return { ok: true, message: "Test message sent. Check your Slack channel." };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, message: e.message };
    console.error("sendSlackTestMessage failed", (e as Error)?.message);
    return { ok: false, message: "Couldn't send the test message." };
  }
}
