import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession, titleFromQuestion } from "@/lib/data/chat";

export type StartedQuestion = {
  sessionId: string;
  newSession: boolean;
  questionId: string;
  questionCreatedAt: string;
  assistantId: string;
};

/**
 * Persist a question BEFORE any AI call, so it's never lost: create the session if needed (lazily,
 * titled from the question), save the user message, and add a `pending` assistant placeholder.
 * `workspaceId` must already have been loaded through RLS by the caller.
 */
export async function startQuestion(
  supabase: SupabaseClient,
  workspaceId: string,
  sessionId: string | null,
  question: string,
): Promise<{ ok: true; value: StartedQuestion } | { ok: false; error: string; status: number }> {
  let newSession = false;
  if (sessionId) {
    if (!(await getSession(workspaceId, sessionId))) return { ok: false, error: "Chat not found.", status: 404 };
  } else {
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ workspace_id: workspaceId, title: titleFromQuestion(question) })
      .select("id")
      .single<{ id: string }>();
    if (error) {
      console.error("creating chat session failed", error.code, error.message);
      return { ok: false, error: "Couldn't start a new chat. Please try again.", status: 500 };
    }
    sessionId = data.id;
    newSession = true;
  }

  const { data: saved, error: qError } = await supabase
    .from("chat_messages")
    .insert({ workspace_id: workspaceId, session_id: sessionId, role: "user", content: question })
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();
  if (qError) {
    console.error("saving question failed", qError.code, qError.message);
    return { ok: false, error: "Couldn't send your message. Please try again.", status: 500 };
  }

  const { data: pending, error: pError } = await supabase
    .from("chat_messages")
    .insert({ workspace_id: workspaceId, session_id: sessionId, role: "assistant", status: "pending", reply_to: saved.id })
    .select("id")
    .single<{ id: string }>();
  if (pError) {
    console.error("creating answer placeholder failed", pError.code, pError.message);
    return { ok: false, error: "Your question was saved, but answering failed to start. Try again.", status: 500 };
  }

  return {
    ok: true,
    value: { sessionId, newSession, questionId: saved.id, questionCreatedAt: saved.created_at, assistantId: pending.id },
  };
}
