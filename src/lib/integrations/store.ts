import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { open, seal } from "@/lib/crypto/secret-box";
import type { SlackInstallation } from "./slack-oauth";

export type SlackConnection = {
  teamName: string | null;
  channelName: string | null;
  configurationUrl: string | null;
  connectedBy: string | null;
  connectedAt: string;
};

type SlackSecret = { webhookUrl: string; accessToken: string | null };

type Row = {
  team_name: string | null;
  channel_name: string | null;
  configuration_url: string | null;
  connected_by: string | null;
  updated_at: string;
  secret_ciphertext: string;
};

// The workspace id is the encryption context: a ciphertext only decrypts for its own workspace.
const context = (workspaceId: string) => `workspace:${workspaceId}:slack`;

// Public connection info (no secrets). RLS: members of the workspace.
export async function getSlackConnection(supabase: SupabaseClient, workspaceId: string): Promise<SlackConnection | null> {
  const { data, error } = await supabase
    .from("workspace_integrations")
    .select("team_name, channel_name, configuration_url, connected_by, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "slack")
    .maybeSingle<Omit<Row, "secret_ciphertext">>();
  if (error) throw error;
  return data
    ? {
        teamName: data.team_name,
        channelName: data.channel_name,
        configurationUrl: data.configuration_url,
        connectedBy: data.connected_by,
        connectedAt: data.updated_at,
      }
    : null;
}

// Decrypted webhook for server-side sending. Null when Slack isn't connected.
export async function getSlackWebhook(supabase: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("workspace_integrations")
    .select("secret_ciphertext")
    .eq("workspace_id", workspaceId)
    .eq("provider", "slack")
    .maybeSingle<Pick<Row, "secret_ciphertext">>();
  if (error) throw error;
  if (!data) return null;
  const secret = JSON.parse(open(data.secret_ciphertext, context(workspaceId))) as SlackSecret;
  return secret.webhookUrl;
}

// Insert or replace the workspace's Slack connection. RLS: workspace owners/admins only.
export async function saveSlackConnection(supabase: SupabaseClient, workspaceId: string, install: SlackInstallation) {
  const secret: SlackSecret = { webhookUrl: install.incoming_webhook.url, accessToken: install.access_token ?? null };
  const { error } = await supabase.from("workspace_integrations").upsert(
    {
      workspace_id: workspaceId,
      provider: "slack",
      team_id: install.team?.id ?? null,
      team_name: install.team?.name ?? null,
      channel_id: install.incoming_webhook.channel_id ?? null,
      channel_name: install.incoming_webhook.channel ?? null,
      configuration_url: install.incoming_webhook.configuration_url ?? null,
      secret_ciphertext: seal(JSON.stringify(secret), context(workspaceId)),
      connected_by: (await supabase.auth.getUser()).data.user?.id,
    },
    { onConflict: "workspace_id,provider" },
  );
  if (error) throw error;
}

// Delete the connection and return its access token (for best-effort revocation). RLS: admins.
export async function deleteSlackConnection(supabase: SupabaseClient, workspaceId: string): Promise<{ deleted: boolean; accessToken: string | null }> {
  const { data, error } = await supabase
    .from("workspace_integrations")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("provider", "slack")
    .select("secret_ciphertext")
    .returns<Pick<Row, "secret_ciphertext">[]>();
  if (error) throw error;
  if (!data.length) return { deleted: false, accessToken: null };
  try {
    return { deleted: true, accessToken: (JSON.parse(open(data[0].secret_ciphertext, context(workspaceId))) as SlackSecret).accessToken };
  } catch {
    return { deleted: true, accessToken: null };
  }
}
