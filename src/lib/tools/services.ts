import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSlackWebhook } from "@/lib/integrations/store";
import { postToSlackWebhook } from "./slack";
import { ToolError, type TaskRow, type ToolServices } from "./types";

type RawTask = { id: string; title: string; notes: string | null; due_date: string | null; status: "open" | "done"; created_at: string };
const toTask = (t: RawTask): TaskRow => ({ id: t.id, title: t.title, notes: t.notes, dueDate: t.due_date, status: t.status, createdAt: t.created_at });
const TASK_COLUMNS = "id, title, notes, due_date, status, created_at";

// Production services: the user-scoped Supabase client (RLS applies), pinned to one workspace,
// session and assistant message that the server resolved from the session.
export function supabaseToolServices(
  supabase: SupabaseClient,
  scope: { workspaceId: string; sessionId: string; messageId: string },
): ToolServices {
  return {
    async createTask({ title, dueDate, notes }) {
      const { data, error } = await supabase
        .from("tasks")
        .insert({ workspace_id: scope.workspaceId, title, due_date: dueDate, notes, source_message_id: scope.messageId })
        .select(TASK_COLUMNS)
        .single<RawTask>();
      if (error) throw error;
      return toTask(data);
    },

    async listTasks({ status, limit }) {
      let q = supabase.from("tasks").select(TASK_COLUMNS).eq("workspace_id", scope.workspaceId);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q
        .order("status", { ascending: false }) // "open" before "done"
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<RawTask[]>();
      if (error) throw error;
      return data.map(toTask);
    },

    // Posts to the Slack channel THIS workspace connected (Settings → Integrations).
    async postToSlack(message) {
      let webhook: string | null;
      try {
        webhook = await getSlackWebhook(supabase, scope.workspaceId);
      } catch (e) {
        console.error("reading Slack connection failed", (e as Error)?.message);
        throw new ToolError("The saved Slack connection couldn't be read. Reconnect Slack in Settings.");
      }
      if (!webhook) {
        throw new ToolError("Slack isn't connected to this workspace. A workspace admin can connect it in Settings → Integrations.");
      }
      await postToSlackWebhook(webhook, message);
    },

    async logToolCall(entry) {
      const { error } = await supabase.from("tool_calls").insert({
        workspace_id: scope.workspaceId,
        session_id: scope.sessionId,
        message_id: scope.messageId,
        tool_name: entry.toolName,
        args: entry.args,
        status: entry.status,
        result: entry.result,
        error: entry.error,
        latency_ms: entry.latencyMs,
      });
      if (error) throw error;
    },
  };
}
