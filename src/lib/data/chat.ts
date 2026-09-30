import "server-only";
import type { Citation } from "@/lib/rag/citations";
import { createClient } from "@/lib/supabase/server";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "error";
  error: string | null;
  replyTo: string | null;
  citations: Citation[];
  model: string | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
};

type Raw = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: ChatMessage["status"];
  error: string | null;
  reply_to: string | null;
  citations: Citation[] | null;
  model: string | null;
  latency_ms: number | null;
  created_at: string;
  updated_at: string;
};

// An answer still "pending" after this long was interrupted (e.g. the function timed out).
export const STALE_PENDING_MS = 90_000;

// The signed-in user's thread in this workspace (RLS also restricts to own messages).
export async function listMessages(workspaceId: string, limit = 100): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, status, error, reply_to, citations, model, latency_ms, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Raw[]>();
  if (error) throw error;

  return data.reverse().map((m) => {
    const stale = m.status === "pending" && Date.now() - new Date(m.updated_at).getTime() > STALE_PENDING_MS;
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      status: stale ? "error" : m.status,
      error: stale ? "This answer was interrupted. Try again." : m.error,
      replyTo: m.reply_to,
      citations: m.citations ?? [],
      model: m.model,
      latencyMs: m.latency_ms,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    };
  });
}
