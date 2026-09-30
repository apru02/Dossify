"use client";

import clsx from "clsx";
import { Check, Loader2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useActionState, useOptimistic, useRef, useTransition } from "react";
import type { Task } from "@/lib/data/tasks";
import { addTask, deleteTask, setTaskDone, type TaskActionResult } from "./actions";

export function AddTaskForm({ workspaceId }: { workspaceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: TaskActionResult, form: FormData) => {
    const res = await addTask(prev, form);
    if (res.ok) formRef.current?.reset();
    return res;
  }, {} as TaskActionResult);

  return (
    <form ref={formRef} action={action} className="rounded-2xl border border-line bg-white p-2 shadow-card">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Add a task…"
          aria-label="Task title"
          className="h-10 min-w-0 flex-1 rounded-xl px-3 text-sm focus:outline-none"
        />
        <input
          name="dueDate"
          type="date"
          aria-label="Due date"
          className="h-10 rounded-xl border border-line px-2 text-sm text-muted focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
        </button>
      </div>
      {state.error && <p className="px-3 pt-2 text-xs text-danger">{state.error}</p>}
    </form>
  );
}

function dueLabel(dueDate: string) {
  const today = new Date().toISOString().slice(0, 10);
  const label = new Date(`${dueDate}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  if (dueDate < today) return { text: `Overdue · ${label}`, className: "bg-danger/10 text-danger" };
  if (dueDate === today) return { text: "Due today", className: "bg-accent/15 text-ink" };
  return { text: `Due ${label}`, className: "bg-canvas text-muted" };
}

// `deletable` is decided on the server (creator or admin); RLS enforces it again on delete.
export function TaskList({ workspaceId, tasks }: { workspaceId: string; tasks: (Task & { deletable: boolean })[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white">
      {tasks.map((t) => (
        <TaskItem key={t.id} workspaceId={workspaceId} task={t} deletable={t.deletable} />
      ))}
    </ul>
  );
}

function TaskItem({ workspaceId, task, deletable }: { workspaceId: string; task: Task; deletable: boolean }) {
  const [pending, startTransition] = useTransition();
  const [done, setOptimisticDone] = useOptimistic(task.status === "done");

  const toggle = () =>
    startTransition(async () => {
      setOptimisticDone(!done);
      const res = await setTaskDone({ workspaceId, taskId: task.id, done: !done });
      if (!res.ok) alert(res.error);
    });

  const remove = () => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    startTransition(async () => {
      const res = await deleteTask({ workspaceId, taskId: task.id });
      if (!res.ok) alert(res.error);
    });
  };

  const due = task.dueDate && !done ? dueLabel(task.dueDate) : null;

  return (
    <li className={clsx("group flex items-start gap-3 px-5 py-3.5", pending && "opacity-60")}>
      <button
        type="button"
        onClick={toggle}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as open` : `Mark "${task.title}" as done`}
        className={clsx(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
          done ? "border-primary bg-primary text-white" : "border-line hover:border-primary",
        )}
      >
        {done && <Check className="size-3.5" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={clsx("text-sm font-medium", done && "text-muted line-through")}>{task.title}</p>
        {task.notes && <p className="mt-0.5 text-xs text-muted">{task.notes}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          {due && <span className={clsx("rounded-full px-2 py-0.5 font-medium", due.className)}>{due.text}</span>}
          {task.fromChat && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" aria-hidden /> Saved by the assistant
            </span>
          )}
        </p>
      </div>
      {deletable && (
        <button
          type="button"
          onClick={remove}
          aria-label={`Delete ${task.title}`}
          className="grid size-8 place-items-center rounded-lg text-muted opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}
