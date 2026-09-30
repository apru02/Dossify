"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  FileSearch,
  FileText,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  SendHorizontal,
  XCircle,
} from "lucide-react";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { askQuestion, retryAnswer } from "@/app/w/[workspaceId]/chat-actions";
import { LogoMark } from "@/components/brand/logo";
import type { ChatMessage, ChatSession } from "@/lib/data/chat";
import type { ToolActivity } from "@/lib/tools/types";
import { AnswerMarkdown } from "./answer-markdown";

const SUGGESTIONS = [
  { icon: FileSearch, label: "Summarize a document", prompt: "Give me a short summary of the documents in this workspace." },
  { icon: Lightbulb, label: "Find key insights", prompt: "What are the most important facts or decisions in these documents?" },
];

type Props = {
  workspaceId: string;
  workspaceName: string;
  session: ChatSession | null; // null = new chat; the first question creates the session
  messages: ChatMessage[];
  readyDocuments: number;
};

function tempMessage(role: ChatMessage["role"], content: string, status: ChatMessage["status"]): ChatMessage {
  const now = new Date().toISOString();
  return { id: `temp-${role}-${now}`, role, content, status, error: null, replyTo: null, citations: [], tools: [], model: null, latencyMs: null, createdAt: now, updatedAt: now };
}

export function ChatPanel({ workspaceId, workspaceName, session, messages, readyDocuments }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [optimistic, addOptimistic] = useOptimistic(messages, (state, question: string) => [
    ...state,
    tempMessage("user", question, "complete"),
    tempMessage("assistant", "", "pending"),
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [optimistic.length]);

  function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;
    setInput("");
    setError(null);
    startSending(async () => {
      addOptimistic(question);
      const res = await askQuestion({ workspaceId, sessionId: session?.id ?? null, question }).catch(() => ({
        ok: false,
        error: "Network error. Your message may not have been sent.",
        sessionId: undefined,
      }));
      // First question of a new chat: move to the session's URL (inside the transition, so the
      // optimistic messages stay on screen until the session page has rendered).
      if (!session && res.sessionId) {
        router.push(`/w/${workspaceId}/c/${res.sessionId}`);
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        setInput(question);
      }
    });
  }

  function retry(messageId: string) {
    setRetryingId(messageId);
    startSending(async () => {
      const res = await retryAnswer({ workspaceId, messageId }).catch(() => ({ ok: false, error: "Network error." }));
      if (!res.ok) setError(res.error ?? "Retry failed.");
      setRetryingId(null);
    });
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-dvh">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-white/60 px-4 backdrop-blur sm:px-6">
        <h1 className="min-w-0 truncate text-sm font-semibold">{session?.title ?? "New chat"}</h1>
        {session && (
          <Link
            href={`/w/${workspaceId}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-lavender"
          >
            <MessageSquarePlus className="size-4" aria-hidden /> New chat
          </Link>
        )}
      </header>
      <div className="flex-1 overflow-y-auto">
        {optimistic.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <LogoMark size={56} />
            <h2 className="mt-5 text-3xl font-bold tracking-tight">Hi there!</h2>
            <p className="mt-2 max-w-md text-sm text-muted">
              Ask questions, get insights, and take action on the documents in{" "}
              <span className="font-semibold text-ink">{workspaceName}</span>.
            </p>
            {readyDocuments === 0 ? (
              <Link
                href={`/w/${workspaceId}/documents`}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                <FileText className="size-4" aria-hidden /> Upload documents to get started
              </Link>
            ) : (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => send(prompt)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs text-muted hover:border-secondary/60 hover:text-ink"
                  >
                    <Icon className="size-3.5 text-primary" aria-hidden /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
            {optimistic.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
                    {m.content}
                  </p>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  workspaceId={workspaceId}
                  message={m}
                  workspaceName={workspaceName}
                  retrying={retryingId === m.id}
                  onRetry={() => retry(m.id)}
                  disabled={sending}
                />
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t border-line bg-canvas/90 px-4 py-4 backdrop-blur sm:px-6">
        <form
          className="mx-auto max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          {error && (
            <p role="alert" className="mb-2 rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-white p-2 shadow-card focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={Math.min(6, Math.max(1, input.split("\n").length))}
              maxLength={2000}
              placeholder="Ask about your documents…"
              aria-label="Ask about your documents"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm placeholder:text-muted/70 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted">
            Answers use only documents in {workspaceName}. Enter to send, Shift+Enter for a new line.
          </p>
        </form>
      </div>
    </div>
  );
}

function AssistantMessage({
  workspaceId,
  message: m,
  workspaceName,
  retrying,
  onRetry,
  disabled,
}: {
  workspaceId: string;
  message: ChatMessage;
  workspaceName: string;
  retrying: boolean;
  onRetry: () => void;
  disabled: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="flex gap-3">
      <LogoMark size={28} className="mt-1 self-start" />
      <div className="min-w-0 flex-1 space-y-3">
        {m.status === "pending" || retrying ? (
          <p className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm text-muted shadow-card">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            Searching {workspaceName}…
          </p>
        ) : m.status === "error" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{m.error}</span>
            <button
              type="button"
              onClick={onRetry}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-sm hover:bg-canvas disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" aria-hidden /> Retry
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-card">
              <AnswerMarkdown content={m.content} onCite={(n) => setActive((a) => (a === n ? null : n))} />
            </div>

            {m.tools.length > 0 && <ToolActivityList workspaceId={workspaceId} tools={m.tools} />}

            {m.citations.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Sources</p>
                <ul className="space-y-1.5">
                  {m.citations.map((c) => (
                    <li key={c.n}>
                      <button
                        type="button"
                        onClick={() => setActive((a) => (a === c.n ? null : c.n))}
                        aria-expanded={active === c.n}
                        className={clsx(
                          "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                          active === c.n ? "border-primary bg-lavender" : "border-line bg-white hover:border-secondary/60",
                        )}
                      >
                        <span className="grid h-5 min-w-5 place-items-center rounded-md bg-primary px-1 text-[11px] font-semibold text-white">
                          {c.n}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-semibold text-ink">{c.documentName}</span>
                          {c.pages && <span className="text-muted"> · {c.pages}</span>}
                          {c.section && <span className="text-muted"> · {c.section}</span>}
                        </span>
                      </button>
                      {active === c.n && (
                        <blockquote className="mt-1.5 rounded-xl border-l-4 border-primary bg-white px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-muted">
                          {c.snippet}
                        </blockquote>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {m.latencyMs !== null && (
              <p className="text-[11px] text-muted">
                {m.model ? `${m.model} · ` : "no LLM call · "}
                {(m.latencyMs / 1000).toFixed(1)}s
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const toolStyles = {
  ok: { icon: CheckCircle2, className: "border-success/20 bg-success/5 text-success" },
  rejected: { icon: Ban, className: "border-line bg-canvas text-muted" },
  error: { icon: XCircle, className: "border-danger/20 bg-danger/5 text-danger" },
} as const;

// What the assistant did (or was stopped from doing) while answering.
function ToolActivityList({ workspaceId, tools }: { workspaceId: string; tools: ToolActivity[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Actions taken">
      {tools.map((t, i) => {
        const { icon: Icon, className } = toolStyles[t.status];
        return (
          <li key={i}>
            <Link
              href={`/w/${workspaceId}/${t.tool === "save_task" || t.tool === "list_tasks" ? "tasks" : "tool-logs"}`}
              className={clsx("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", className)}
              title={t.label}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
