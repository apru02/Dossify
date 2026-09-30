"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { answerQuestion } from "@/lib/chat/answer";
import { STALE_PENDING_MS, getSession, titleFromQuestion } from "@/lib/data/chat";
import { getWorkspace } from "@/lib/data/workspaces";
import { createClient } from "@/lib/supabase/server";

export type ChatActionResult = { ok: boolean; error?: string; sessionId?: string };

const askSchema = z.object({
  workspaceId: z.uuid(),
  sessionId: z.uuid().nullable(),
  question: z.string().trim().min(1, "Type a question").max(2000, "Keep questions under 2,000 characters"),
});

// Refreshes the chat page AND the layout (sidebar list of sessions).
const refresh = (workspaceId: string) => revalidatePath(`/w/${workspaceId}`, "layout");

export async function askQuestion(input: {
  workspaceId: string;
  sessionId: string | null; // null = start a new chat with this question
  question: string;
}): Promise<ChatActionResult> {
  await requireUser();
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { question } = parsed.data;

  // RLS-scoped loads: ids from the browser are only lookup keys.
  const workspace = await getWorkspace(parsed.data.workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };

  const supabase = await createClient();

  let sessionId = parsed.data.sessionId;
  if (sessionId) {
    if (!(await getSession(workspace.id, sessionId))) return { ok: false, error: "Chat not found." };
  } else {
    // Sessions are created lazily on the first question, so "New chat" never leaves empty sessions.
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ workspace_id: workspace.id, title: titleFromQuestion(question) })
      .select("id")
      .single<{ id: string }>();
    if (error) {
      console.error("creating chat session failed", error.code, error.message);
      return { ok: false, error: "Couldn't start a new chat. Please try again." };
    }
    sessionId = data.id;
  }

  // 1. Persist the question BEFORE calling any AI service, so it's never lost.
  const { data: saved, error: qError } = await supabase
    .from("chat_messages")
    .insert({ workspace_id: workspace.id, session_id: sessionId, role: "user", content: question })
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();
  if (qError) {
    console.error("saving question failed", qError.code, qError.message);
    return { ok: false, error: "Couldn't send your message. Please try again.", sessionId };
  }

  const { data: pending, error: pError } = await supabase
    .from("chat_messages")
    .insert({ workspace_id: workspace.id, session_id: sessionId, role: "assistant", status: "pending", reply_to: saved.id })
    .select("id")
    .single<{ id: string }>();
  if (pError) {
    console.error("creating answer placeholder failed", pError.code, pError.message);
    refresh(workspace.id);
    return { ok: false, error: "Your question was saved, but answering failed to start. Try again.", sessionId };
  }

  // 2. Retrieve (across ALL of the workspace's documents) + generate. Failures are recorded on
  //    the placeholder row, not thrown.
  await answerQuestion(supabase, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    sessionId,
    assistantId: pending.id,
    question,
    questionCreatedAt: saved.created_at,
  });

  refresh(workspace.id);
  return { ok: true, sessionId };
}

export async function retryAnswer(input: { workspaceId: string; messageId: string }): Promise<ChatActionResult> {
  await requireUser();
  const parsed = z.object({ workspaceId: z.uuid(), messageId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const workspace = await getWorkspace(parsed.data.workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };

  const supabase = await createClient();
  const { data: answer } = await supabase
    .from("chat_messages")
    .select("id, status, updated_at, reply_to, session_id")
    .eq("id", parsed.data.messageId)
    .eq("workspace_id", workspace.id)
    .eq("role", "assistant")
    .maybeSingle<{ id: string; status: string; updated_at: string; reply_to: string; session_id: string }>();
  if (!answer) return { ok: false, error: "Message not found." };

  const stalePending = answer.status === "pending" && Date.now() - new Date(answer.updated_at).getTime() > STALE_PENDING_MS;
  if (answer.status !== "error" && !stalePending) return { ok: false, error: "This answer isn't retryable." };

  const { data: question } = await supabase
    .from("chat_messages")
    .select("content, created_at")
    .eq("id", answer.reply_to)
    .single<{ content: string; created_at: string }>();
  if (!question) return { ok: false, error: "Original question not found." };

  await supabase.from("chat_messages").update({ status: "pending", error: null }).eq("id", answer.id);
  await answerQuestion(supabase, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    sessionId: answer.session_id,
    assistantId: answer.id,
    question: question.content,
    questionCreatedAt: question.created_at,
  });

  refresh(workspace.id);
  return { ok: true, sessionId: answer.session_id };
}

const sessionRef = z.object({ workspaceId: z.uuid(), sessionId: z.uuid() });

export async function renameSession(input: { workspaceId: string; sessionId: string; title: string }): Promise<ChatActionResult> {
  await requireUser();
  const parsed = sessionRef
    .extend({ title: z.string().trim().min(1, "Title can't be empty").max(120, "Keep titles under 120 characters") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_sessions")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.sessionId)
    .eq("workspace_id", parsed.data.workspaceId)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("renameSession failed", error.code, error.message);
    return { ok: false, error: "Couldn't rename this chat." };
  }
  refresh(parsed.data.workspaceId);
  return { ok: true };
}

export async function deleteSession(input: { workspaceId: string; sessionId: string }): Promise<ChatActionResult> {
  await requireUser();
  const parsed = sessionRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  // RLS: only your own sessions. Messages cascade.
  const { data, error } = await supabase
    .from("chat_sessions")
    .delete()
    .eq("id", parsed.data.sessionId)
    .eq("workspace_id", parsed.data.workspaceId)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("deleteSession failed", error.code, error.message);
    return { ok: false, error: "Couldn't delete this chat." };
  }
  refresh(parsed.data.workspaceId);
  return { ok: true };
}
