"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteDocument } from "./actions";

export function DeleteDocumentButton({ workspaceId, documentId, name }: { workspaceId: string; documentId: string; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Delete ${name}`}
      title="Delete"
      onClick={() => {
        if (!confirm(`Delete "${name}"? The assistant will no longer be able to use it.`)) return;
        const form = new FormData();
        form.set("workspaceId", workspaceId);
        form.set("documentId", documentId);
        startTransition(async () => {
          const res = await deleteDocument(form);
          if (!res.ok) alert(res.message);
        });
      }}
      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}
