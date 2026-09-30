"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/data/workspaces";
import { createClient } from "@/lib/supabase/server";

export type TaskActionResult = { ok: boolean; error?: string };

const ref = z.object({ workspaceId: z.uuid(), taskId: z.uuid() });

export async function addTask(_: TaskActionResult, form: FormData): Promise<TaskActionResult> {
  await requireUser();
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      title: z.string().trim().min(1, "Enter a task").max(200, "Keep it under 200 characters"),
      dueDate: z.union([z.iso.date(), z.literal("")]).optional(),
    })
    .safeParse({ workspaceId: form.get("workspaceId"), title: form.get("title"), dueDate: form.get("dueDate") ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const workspace = await getWorkspace(parsed.data.workspaceId);
  if (!workspace) return { ok: false, error: "Workspace not found." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .insert({ workspace_id: workspace.id, title: parsed.data.title, due_date: parsed.data.dueDate || null });
  if (error) {
    console.error("addTask failed", error.code, error.message);
    return { ok: false, error: "Couldn't add the task." };
  }
  revalidatePath(`/w/${workspace.id}/tasks`);
  return { ok: true };
}

export async function setTaskDone(input: { workspaceId: string; taskId: string; done: boolean }): Promise<TaskActionResult> {
  await requireUser();
  const parsed = ref.extend({ done: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: parsed.data.done ? "done" : "open", completed_at: parsed.data.done ? new Date().toISOString() : null })
    .eq("id", parsed.data.taskId)
    .eq("workspace_id", parsed.data.workspaceId)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("setTaskDone failed", error.code, error.message);
    return { ok: false, error: "Couldn't update the task." };
  }
  revalidatePath(`/w/${parsed.data.workspaceId}/tasks`);
  return { ok: true };
}

export async function deleteTask(input: { workspaceId: string; taskId: string }): Promise<TaskActionResult> {
  await requireUser();
  const parsed = ref.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  // RLS: only the task's creator or a workspace admin.
  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", parsed.data.taskId)
    .eq("workspace_id", parsed.data.workspaceId)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("deleteTask failed", error.code, error.message);
    return { ok: false, error: "Only the task's creator or an admin can delete it." };
  }
  revalidatePath(`/w/${parsed.data.workspaceId}/tasks`);
  return { ok: true };
}
