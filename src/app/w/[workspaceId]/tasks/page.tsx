import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { countTasks, listTasks } from "@/lib/data/tasks";
import { getMyRole, getWorkspace } from "@/lib/data/workspaces";
import { AddTaskForm, TaskList } from "./task-list";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ params, searchParams }: PageProps<"/w/[workspaceId]/tasks">) {
  const { workspaceId } = await params;
  const view = (await searchParams).view === "done" ? "done" : "open";
  const user = await requireUser();
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing
  const [tasks, counts, role] = await Promise.all([
    listTasks(workspace.id, view),
    countTasks(workspace.id),
    getMyRole(workspace.organization.id, user.id),
  ]);
  const isAdmin = role === "owner" || role === "admin";

  return (
    <>
      <PageHeader
        title="Tasks"
        description={`Shared with everyone in ${workspace.name}. Ask the assistant to "remind me to…" or add one here.`}
      />
      <div className="mx-auto max-w-4xl space-y-6 p-6 sm:p-10">
        <AddTaskForm workspaceId={workspace.id} />

        <nav className="flex gap-1 rounded-xl bg-white p-1 text-sm shadow-card sm:w-fit" aria-label="Task filter">
          {(["open", "done"] as const).map((v) => (
            <Link
              key={v}
              href={v === "open" ? `/w/${workspace.id}/tasks` : `/w/${workspace.id}/tasks?view=done`}
              aria-current={view === v ? "page" : undefined}
              className={clsx(
                "flex-1 rounded-lg px-4 py-1.5 text-center font-medium capitalize",
                view === v ? "bg-lavender text-primary" : "text-muted hover:text-ink",
              )}
            >
              {v} <span className="text-xs opacity-70">({counts[v]})</span>
            </Link>
          ))}
        </nav>

        {tasks.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title={view === "open" ? "Nothing to do" : "No completed tasks yet"}
            body={view === "open" ? "Try asking in chat: “Remind me to renew the contract by Friday.”" : "Tick a task to mark it done."}
          />
        ) : (
          <TaskList
            workspaceId={workspace.id}
            tasks={tasks.map((t) => ({ ...t, deletable: isAdmin || t.createdBy === user.id }))}
          />
        )}
      </div>
    </>
  );
}
