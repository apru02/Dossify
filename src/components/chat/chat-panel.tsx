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
import { useEffect, useRef, useState, useTransition } from "react";
import { retryAnswer } from "@/app/w/[workspaceId]/chat-actions";
import { LogoMark } from "@/components/brand/logo";
import type { FinalAnswer } from "@/lib/chat/answer";
import { readChatStream } from "@/lib/chat/stream-events";
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

// The exchange currently streaming. It's drawn after the server-rendered `messages` and hidden
// automatically once a refresh delivers new messages (which then include the saved answer).
type Live = {
  base: ChatMessage[];
  question: string;
  assistantId: string | null;
  text: string;
  status: string;
  tools: ToolActivity[];
  final: FinalAnswer | null;
  failed: string | null;
};

function liveMessages(live: Live): ChatMessage[] {
  const now = new Date().toISOString();
  const base = { replyTo: null, citations: [], tools: [], model: null, latencyMs: null, error: null, createdAt: now, updatedAt: now };
  const f = live.final;
  return [
    { ...base, id: "live-question", role: "user", content: live.question, status: "complete" },
    {
      ...base,
      id: live.assistantId ?? "live-answer",
      role: "assistant",
      content: f?.content ?? live.text,
      status: f ? f.status : live.failed ? "error" : "pending",
      error: f?.error ?? live.failed,
      citations: f?.citations ?? [],
      tools: f?.tools ?? live.tools,
      model: f?.model ?? null,
      latencyMs: f?.latencyMs ?? null,
    },
  ];
}

export function ChatPanel({ workspaceId, workspaceName, session, messages, readyDocuments }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();
  const [, startRefresh] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const shown = live && live.base === messages ? [...messages, ...liveMessages(live)] : messages;
  const busy = streaming || retrying;

  // Follow the answer as it streams, unless the user has scrolled up to read something.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [shown.length, live?.text.length, live?.tools.length, live?.final]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setError(null);
    setStreaming(true);
    stickToBottom.current = true;
    setLive({ base: messages, question, assistantId: null, text: "", status: `Searching ${workspaceName}…`, tools: [], final: null, failed: null });

    let sessionId = session?.id ?? null;
    let newSession = false;
    let accepted = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, sessionId, question }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't send your message. Please try again.");
      }
      accepted = true;
      for await (const event of readChatStream(res.body)) {
        if (event.type === "start") {
          sessionId = event.sessionId;
          newSession = event.newSession;
        }
        setLive((l) => {
          if (!l) return l;
          switch (event.type) {
            case "start":
              return { ...l, assistantId: event.assistantId };
            case "status":
              return { ...l, status: event.text };
            case "delta":
              return { ...l, text: l.text + event.text };
            case "tool":
              return { ...l, tools: [...l.tools, event.activity] };
            case "done":
              return { ...l, final: event.answer };
          }
        });
      }
    } catch (e) {
      if (!accepted) {
        // Nothing was saved: give the question back.
        setLive(null);
        setInput(question);
        setError(e instanceof Error ? e.message : "Couldn't send your message.");
        setStreaming(false);
        return;
      }
      setLive((l) => l && { ...l, failed: "Connection lost. Your question is saved; the answer will appear when it's ready." });
    }
    setStreaming(false);
    // Swap the live draft for the saved messages (and refresh the sidebar's chat list).
    startRefresh(() => {
      if (newSession && sessionId) router.push(`/w/${workspaceId}/c/${sessionId}`);
      else router.refresh();
    });
  }

  function retry(messageId: string) {
    setRetryingId(messageId);
    startRetry(async () => {
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
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 overflow-y-auto"
      >
        {shown.length === 0 ? (
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
            {shown.map((m) =>
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
                  statusText={live && m.id === (live.assistantId ?? "live-answer") ? live.status : `Searching ${workspaceName}…`}
                  retrying={retryingId === m.id}
                  onRetry={() => retry(m.id)}
                  disabled={busy}
                />
              ),
            )}
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
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
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
  statusText,
  retrying,
  onRetry,
  disabled,
}: {
  workspaceId: string;
  message: ChatMessage;
  statusText: string;
  retrying: boolean;
  onRetry: () => void;
  disabled: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="flex gap-3">
      <LogoMark size={28} className="mt-1 self-start" />
      <div className="min-w-0 flex-1 space-y-3">
        {(m.status === "pending" || retrying) && !m.content ? (
          <>
            {m.tools.length > 0 && <ToolActivityList workspaceId={workspaceId} tools={m.tools} />}
            <p className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm text-muted shadow-card" aria-live="polite">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              {retrying ? "Trying again…" : statusText}
            </p>
          </>
        ) : m.status === "pending" ? (
          // Streaming: text arrives token by token; sources and stats appear when it's done.
          <>
            <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-card" aria-live="polite" aria-busy="true">
              <AnswerMarkdown content={m.content} onCite={() => {}} />
              <span className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" aria-hidden />
            </div>
            {m.tools.length > 0 && <ToolActivityList workspaceId={workspaceId} tools={m.tools} />}
          </>
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
