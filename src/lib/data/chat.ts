import "server-only";
import { cache } from "react";
import type { Citation } from "@/lib/rag/citations";
import type { ToolActivity } from "@/lib/tools/types";
import { toolActivityByMessage } from "./tool-calls";
import { isUuid } from "@/lib/data/workspaces";
import { createClient } from "@/lib/supabase/server";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "error";
  error: string | null;
  replyTo: string | null;
  citations: Citation[];
  tools: ToolActivity[];
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

export type ChatSession = { id: string; title: string; updatedAt: string };

type RawSession = { id: string; title: string; updated_at: string };
const toSession = (s: RawSession): ChatSession => ({ id: s.id, title: s.title, updatedAt: s.updated_at });

// The signed-in user's sessions in this workspace, most recently active first (RLS: own only).
export const listSessions = cache(async (workspaceId: string, limit = 50): Promise<ChatSession[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id, title, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<RawSession[]>();
  if (error) throw error;
  return data.map(toSession);
});

// Null when the session doesn't exist, isn't the user's, or belongs to another workspace.
export async function getSession(workspaceId: string, sessionId: string): Promise<ChatSession | null> {
  if (!isUuid(sessionId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id, title, updated_at")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle<RawSession>();
  if (error) throw error;
  return data ? toSession(data) : null;
}

// Short title from the first question, cut at a word boundary.
export function titleFromQuestion(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

export async function listMessages(workspaceId: string, sessionId: string, limit = 200): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, status, error, reply_to, citations, model, latency_ms, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Raw[]>();
  if (error) throw error;

  const tools = await toolActivityByMessage(data.filter((m) => m.role === "assistant").map((m) => m.id));

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
      tools: tools.get(m.id) ?? [],
      model: m.model,
      latencyMs: m.latency_ms,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    };
  });
}
