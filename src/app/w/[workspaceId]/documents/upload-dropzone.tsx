"use client";

import clsx from "clsx";
import { CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { uploadDocument } from "./actions";

const ACCEPT = ".pdf,.md,.markdown,.txt";
const MAX_BYTES = 4 * 1024 * 1024;

type Item = { key: string; name: string; state: "queued" | "uploading" | "done" | "error"; message?: string };

// Uploads files one at a time (keeps each request under Vercel's body limit and the
// free-tier embedding rate limit) and shows per-file progress.
export function UploadDropzone({ workspaceId }: { workspaceId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, startTransition] = useTransition();

  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const queue = Array.from(files).map((file) => ({
      file,
      item: { key: `${file.name}-${file.size}-${crypto.randomUUID()}`, name: file.name, state: "queued" as const },
    }));
    setItems((prev) => [...queue.map((q) => q.item), ...prev].slice(0, 20));

    startTransition(async () => {
      for (const { file, item } of queue) {
        if (file.size > MAX_BYTES) {
          update(item.key, { state: "error", message: "Files must be 4 MB or smaller." });
          continue;
        }
        update(item.key, { state: "uploading" });
        const form = new FormData();
        form.set("workspaceId", workspaceId);
        form.set("file", file);
        try {
          const res = await uploadDocument(form);
          update(item.key, { state: res.ok ? "done" : "error", message: res.message });
        } catch {
          update(item.key, { state: "error", message: "Upload failed. Check your connection and try again." });
        }
      }
    });
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={clsx(
          "flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-primary bg-lavender" : "border-line bg-white",
        )}
      >
        <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-lavender text-primary">
          <UploadCloud className="size-6" aria-hidden />
        </span>
        <p className="text-sm font-semibold">Drop files here or</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Choose files"}
        </button>
        <p className="mt-3 text-xs text-muted">PDF, Markdown or TXT · up to 4 MB each · PDFs need selectable text</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className="flex items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm">
              {it.state === "done" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : it.state === "error" ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              ) : (
                <Loader2 className={clsx("mt-0.5 size-4 shrink-0 text-primary", it.state === "uploading" && "animate-spin")} aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{it.name}</span>
                <span className={clsx("block text-xs", it.state === "error" ? "text-danger" : "text-muted")}>
                  {it.state === "queued"
                    ? "Waiting…"
                    : it.state === "uploading"
                      ? "Reading, chunking and embedding…"
                      : it.message}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
