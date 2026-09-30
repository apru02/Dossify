import type { Metadata } from "next";
import clsx from "clsx";
import { Ban, CheckCircle2, ScrollText, XCircle } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { listToolCalls, type ToolCallRow } from "@/lib/data/tool-calls";
import { getWorkspace } from "@/lib/data/workspaces";

export const metadata: Metadata = { title: "Tool Logs" };

const statusStyle: Record<ToolCallRow["status"], { icon: typeof CheckCircle2; className: string; text: string }> = {
  ok: { icon: CheckCircle2, className: "bg-success/10 text-success", text: "Succeeded" },
  rejected: { icon: Ban, className: "bg-canvas text-muted", text: "Blocked" },
  error: { icon: XCircle, className: "bg-danger/10 text-danger", text: "Failed" },
};

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-xl bg-canvas p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function ToolLogsPage({ params }: PageProps<"/w/[workspaceId]/tool-logs">) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing
  const calls = await listToolCalls(workspace.id, user.id);

  const counts = { ok: 0, rejected: 0, error: 0 };
  for (const c of calls) counts[c.status]++;

  return (
    <>
      <PageHeader
        title="Tool Logs"
        description="Every tool the assistant tried to call in this workspace: arguments, result, and whether it ran."
      />
      <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-10">
        {calls.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No tool calls yet"
            body="When the assistant saves a task, lists tasks or posts to Slack, it's recorded here, including calls that were blocked."
          />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(counts) as ToolCallRow["status"][]).map((s) => {
                const { icon: Icon, className, text } = statusStyle[s];
                return (
                  <div key={s} className="rounded-2xl border border-line bg-white p-4">
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <span className={clsx("grid size-5 place-items-center rounded-full", className)}>
                        <Icon className="size-3" aria-hidden />
                      </span>
                      {text}
                    </p>
                    <p className="mt-1 text-2xl font-semibold">{counts[s]}</p>
                  </div>
                );
              })}
            </div>

            <ul className="space-y-2">
              {calls.map((c) => {
                const { icon: Icon, className, text } = statusStyle[c.status];
                return (
                  <li key={c.id}>
                    <details className="group rounded-2xl border border-line bg-white">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                        <span className={clsx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", className)}>
                          <Icon className="size-3" aria-hidden /> {text}
                        </span>
                        <code className="shrink-0 rounded-md bg-lavender px-1.5 py-0.5 text-xs text-primary">{c.toolName}</code>
                        <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
                        <span className="hidden shrink-0 text-xs text-muted sm:inline">
                          {c.userLabel} · {new Date(c.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                          {c.latencyMs !== null && ` · ${c.latencyMs} ms`}
                        </span>
                      </summary>
                      <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
                        <div>
                          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Arguments (from the model)</p>
                          <Json value={c.args} />
                        </div>
                        <div>
                          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
                            {c.status === "ok" ? "Result" : "Reason"}
                          </p>
                          {c.status === "ok" ? <Json value={c.result} /> : <p className="text-sm text-danger">{c.error}</p>}
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
