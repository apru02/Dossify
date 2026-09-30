"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { displayName, requireUser } from "@/lib/auth";
import { answerQuestion } from "@/lib/chat/answer";
import { STALE_PENDING_MS } from "@/lib/data/chat";
import { getWorkspace } from "@/lib/data/workspaces";
import { createClient } from "@/lib/supabase/server";

export type ChatActionResult = { ok: boolean; error?: string; sessionId?: string };

// Refreshes the chat page AND the layout (sidebar list of sessions).
const refresh = (workspaceId: string) => revalidatePath(`/w/${workspaceId}`, "layout");

// Asking a question is POST /api/chat (streaming). Retry, rename and delete stay Server Actions.

export async function retryAnswer(input: { workspaceId: string; messageId: string }): Promise<ChatActionResult> {
  const user = await requireUser();
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
    userName: displayName(user),
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
