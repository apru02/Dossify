import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  status: "open" | "done";
  createdBy: string | null;
  fromChat: boolean;
  createdAt: string;
  completedAt: string | null;
};

type Raw = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: "open" | "done";
  created_by: string | null;
  source_message_id: string | null;
  created_at: string;
  completed_at: string | null;
};

// Workspace tasks (shared with every member, RLS). Open tasks: soonest due first.
export async function listTasks(workspaceId: string, status: "open" | "done"): Promise<Task[]> {
  const supabase = await createClient();
  let q = supabase
    .from("tasks")
    .select("id, title, notes, due_date, status, created_by, source_message_id, created_at, completed_at")
    .eq("workspace_id", workspaceId)
    .eq("status", status);
  q =
    status === "open"
      ? q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false })
      : q.order("completed_at", { ascending: false });
  const { data, error } = await q.limit(200).returns<Raw[]>();
  if (error) throw error;
  return data.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.due_date,
    status: t.status,
    createdBy: t.created_by,
    fromChat: t.source_message_id !== null,
    createdAt: t.created_at,
    completedAt: t.completed_at,
  }));
}

export async function countTasks(workspaceId: string): Promise<{ open: number; done: number }> {
  const supabase = await createClient();
  const count = async (status: string) => {
    const { count: n } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", status);
    return n ?? 0;
  };
  const [open, done] = await Promise.all([count("open"), count("done")]);
  return { open, done };
}
