"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, Loader2, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteSession, renameSession } from "@/app/w/[workspaceId]/chat-actions";
import type { ChatSession } from "@/lib/data/chat";

export function NewChatButton({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const active = pathname === `/w/${workspaceId}`;
  return (
    <Link
      href={`/w/${workspaceId}`}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
        active ? "bg-primary text-white" : "bg-lavender text-primary hover:bg-primary hover:text-white",
      )}
    >
      <MessageSquarePlus className="size-4" aria-hidden />
      New chat
    </Link>
  );
}

// The user's chat sessions in this workspace, most recent first, with inline rename/delete.
export function ChatSessionList({ workspaceId, sessions }: { workspaceId: string; sessions: ChatSession[] }) {
  if (sessions.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted">No chats yet. Ask a question to start one.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {sessions.map((s) => (
        <SessionItem key={s.id} workspaceId={workspaceId} session={s} />
      ))}
    </ul>
  );
}

function SessionItem({ workspaceId, session }: { workspaceId: string; session: ChatSession }) {
  const pathname = usePathname();
  const router = useRouter();
  const href = `/w/${workspaceId}/c/${session.id}`;
  const active = pathname === href;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [pending, startTransition] = useTransition();

  function save() {
    const next = title.trim();
    if (!next || next === session.title) {
      setEditing(false);
      setTitle(session.title);
      return;
    }
    startTransition(async () => {
      const res = await renameSession({ workspaceId, sessionId: session.id, title: next });
      if (!res.ok) {
        alert(res.error);
        setTitle(session.title);
      }
      setEditing(false);
    });
  }

  function remove() {
    if (!confirm(`Delete "${session.title}"? Its messages will be deleted too.`)) return;
    startTransition(async () => {
      const res = await deleteSession({ workspaceId, sessionId: session.id });
      if (!res.ok) return alert(res.error);
      if (active) router.push(`/w/${workspaceId}`);
    });
  }

  if (editing) {
    return (
      <li className="flex items-center gap-1 rounded-xl bg-canvas px-2 py-1.5">
        <input
          autoFocus
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setEditing(false);
              setTitle(session.title);
            }
          }}
          aria-label="Chat title"
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-white px-2 text-sm focus:border-primary focus:outline-none"
        />
        <button type="button" onClick={save} disabled={pending} aria-label="Save title" className="grid size-7 place-items-center rounded-md text-primary hover:bg-lavender">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setTitle(session.title);
          }}
          aria-label="Cancel"
          className="grid size-7 place-items-center rounded-md text-muted hover:bg-white"
        >
          <X className="size-3.5" />
        </button>
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        title={session.title}
        className={clsx(
          "block truncate rounded-xl py-2 pr-16 pl-3 text-sm transition-colors",
          active ? "bg-lavender font-semibold text-primary" : "text-ink/80 hover:bg-canvas",
          pending && "opacity-50",
        )}
      >
        {session.title}
      </Link>
      <span
        className={clsx(
          "absolute inset-y-0 right-1 flex items-center gap-0.5",
          "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
          active && "opacity-100",
        )}
      >
        <button type="button" onClick={() => setEditing(true)} aria-label={`Rename ${session.title}`} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white hover:text-primary">
          <Pencil className="size-3.5" />
        </button>
        <button type="button" onClick={remove} disabled={pending} aria-label={`Delete ${session.title}`} className="grid size-7 place-items-center rounded-md text-muted hover:bg-white hover:text-danger">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      </span>
    </li>
  );
}
