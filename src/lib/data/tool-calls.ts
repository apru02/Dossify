import "server-only";
import { TOOLS_BY_NAME } from "@/lib/tools/registry";
import type { ToolActivity, ToolCallStatus } from "@/lib/tools/types";
import { createClient } from "@/lib/supabase/server";

export type ToolCallRow = {
  id: string;
  toolName: string;
  status: ToolCallStatus;
  args: unknown;
  result: unknown;
  error: string | null;
  latencyMs: number | null;
  userId: string;
  userLabel: string;
  createdAt: string;
  label: string;
};

type Raw = {
  id: string;
  tool_name: string;
  status: ToolCallStatus;
  args: unknown;
  result: Record<string, unknown> | null;
  error: string | null;
  latency_ms: number | null;
  user_id: string;
  message_id: string | null;
  created_at: string;
};

// Human-readable one-liner for a logged call (same wording the chat shows).
export function describeToolCall(r: Pick<Raw, "tool_name" | "status" | "args" | "result" | "error">): string {
  const tool = TOOLS_BY_NAME.get(r.tool_name);
  if (r.status === "ok" && tool && r.result) {
    try {
      return tool.label(r.args as never, r.result);
    } catch {
      /* fall through */
    }
  }
  if (r.status === "ok") return `${r.tool_name} succeeded`;
  const reason = (r.error ?? "").split(/[.:]/)[0];
  return r.status === "rejected" ? `Blocked ${r.tool_name}: ${reason}` : `${r.tool_name} failed: ${r.error ?? "error"}`;
}

const COLUMNS = "id, tool_name, status, args, result, error, latency_ms, user_id, message_id, created_at";

// The workspace's audit log (visible to every member, RLS).
export async function listToolCalls(workspaceId: string, currentUserId: string, limit = 100): Promise<ToolCallRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tool_calls")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Raw[]>();
  if (error) throw error;

  const otherIds = [...new Set(data.map((r) => r.user_id).filter((id) => id !== currentUserId))];
  const names = new Map<string, string>();
  if (otherIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", otherIds)
      .returns<{ id: string; full_name: string | null; email: string | null }[]>();
    for (const p of profiles ?? []) names.set(p.id, p.full_name || p.email || "Teammate");
  }

  return data.map((r) => ({
    id: r.id,
    toolName: r.tool_name,
    status: r.status,
    args: r.args,
    result: r.result,
    error: r.error,
    latencyMs: r.latency_ms,
    userId: r.user_id,
    userLabel: r.user_id === currentUserId ? "You" : (names.get(r.user_id) ?? "Teammate"),
    createdAt: r.created_at,
    label: describeToolCall(r),
  }));
}

// Tool activity per assistant message, for the chat view.
export async function toolActivityByMessage(messageIds: string[]): Promise<Map<string, ToolActivity[]>> {
  const out = new Map<string, ToolActivity[]>();
  if (!messageIds.length) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tool_calls")
    .select(COLUMNS)
    .in("message_id", messageIds)
    .order("created_at", { ascending: true })
    .returns<Raw[]>();
  if (error) throw error;
  for (const r of data) {
    const list = out.get(r.message_id!) ?? [];
    list.push({ tool: r.tool_name, status: r.status, label: describeToolCall(r) });
    out.set(r.message_id!, list);
  }
  return out;
}
