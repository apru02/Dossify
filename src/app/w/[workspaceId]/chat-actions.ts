"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { answerQuestion } from "@/lib/chat/answer";
import { STALE_PENDING_MS } from "@/lib/data/chat";
import { getWorkspace } from "@/lib/data/workspaces";
import { createClient } from "@/lib/supabase/server";

export type ChatActionResult = { ok: boolean; error?: string };

const askSchema = z.object({
  workspaceId: z.uuid(),
  question: z.string().trim().min(1, "Type a question").max(2000, "Keep questions under 2,000 characters"),
});

export async function askQuestion(input: { workspaceId: string; question: string }): Promise<ChatActionResult> {
  await requireUser();
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  // RLS-scoped load: the workspace id from the browser is only a lookup key.
  const workspace = await getWorkspace(parsed.data.workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };

  const supabase = await createClient();

  // 1. Persist the question BEFORE calling any AI service, so it's never lost.
  const { data: question, error: qError } = await supabase
    .from("chat_messages")
    .insert({ workspace_id: workspace.id, role: "user", content: parsed.data.question })
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();
  if (qError) {
    console.error("saving question failed", qError.code, qError.message);
    return { ok: false, error: "Couldn't send your message. Please try again." };
  }

  const { data: pending, error: pError } = await supabase
    .from("chat_messages")
    .insert({ workspace_id: workspace.id, role: "assistant", status: "pending", reply_to: question.id })
    .select("id")
    .single<{ id: string }>();
  if (pError) {
    console.error("creating answer placeholder failed", pError.code, pError.message);
    revalidatePath(`/w/${workspace.id}`);
    return { ok: false, error: "Your question was saved, but answering failed to start. Try again." };
  }

  // 2. Retrieve + generate; failures are recorded on the placeholder row, not thrown.
  await answerQuestion(supabase, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    assistantId: pending.id,
    question: parsed.data.question,
    questionCreatedAt: question.created_at,
  });

  revalidatePath(`/w/${workspace.id}`);
  return { ok: true };
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
    .select("id, status, updated_at, reply_to")
    .eq("id", parsed.data.messageId)
    .eq("workspace_id", workspace.id)
    .eq("role", "assistant")
    .maybeSingle<{ id: string; status: string; updated_at: string; reply_to: string }>();
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
    assistantId: answer.id,
    question: question.content,
    questionCreatedAt: question.created_at,
  });

  revalidatePath(`/w/${workspace.id}`);
  return { ok: true };
}
