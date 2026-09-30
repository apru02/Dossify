import { FileSearch, Lightbulb, Search, SendHorizontal } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { getWorkspace } from "@/lib/data/workspaces";

// Chat UI shell. The RAG + tool-calling pipeline is wired up in a later step.
export default async function ChatPage({ params }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col md:min-h-screen">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <LogoMark size={56} />
        <h1 className="mt-5 text-3xl font-bold tracking-tight">Hi there!</h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          Ask questions, get insights, and take action on the documents in{" "}
          <span className="font-semibold text-ink">{workspace.name}</span>.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {[
            { icon: FileSearch, label: "Summarize a document" },
            { icon: Lightbulb, label: "Find key insights" },
          ].map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs text-muted"
            >
              <Icon className="size-3.5 text-primary" aria-hidden /> {label}
            </span>
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-line bg-canvas/90 px-4 py-4 backdrop-blur sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-line bg-white p-2 shadow-card">
          <Search className="ml-2 size-4 text-muted" aria-hidden />
          <input
            disabled
            placeholder="Ask about your documents…"
            aria-label="Ask about your documents"
            className="h-10 flex-1 bg-transparent text-sm placeholder:text-muted/70 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            disabled
            aria-label="Send"
            className="grid size-10 place-items-center rounded-xl bg-primary text-white disabled:opacity-50"
          >
            <SendHorizontal className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-muted">Chat is coming in the next build step.</p>
      </div>
    </div>
  );
}
