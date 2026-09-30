"use client";

import clsx from "clsx";
import Link from "next/link";
import { Building2, Check, ChevronsUpDown, Plus, User } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { createWorkspace, type CreateWorkspaceState } from "@/app/w/actions";
import type { Workspace } from "@/lib/data/workspaces";

export function WorkspaceSwitcher({ current, workspaces }: { current: Workspace; workspaces: Workspace[] }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [state, action, pending] = useActionState(createWorkspace, {} as CreateWorkspaceState);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Group by account so a user who is in several organizations sees them separately.
  const groups = new Map<string, { org: Workspace["organization"]; items: Workspace[] }>();
  for (const w of workspaces) {
    const g = groups.get(w.organization.id) ?? { org: w.organization, items: [] };
    g.items.push(w);
    groups.set(w.organization.id, g);
  }
  const OrgIcon = current.organization.kind === "organization" ? Building2 : User;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-secondary/60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lavender text-primary">
          <OrgIcon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-muted">{current.organization.name}</span>
          <span className="block truncate text-sm font-semibold text-ink">{current.name}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-line bg-white shadow-card">
          <div className="max-h-72 overflow-y-auto p-1.5" role="listbox" aria-label="Workspaces">
            {[...groups.values()].map(({ org, items }) => (
              <div key={org.id} className="py-1">
                <p className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {org.name}
                  <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] normal-case">
                    {org.kind === "organization" ? "Organization" : "Personal"}
                  </span>
                </p>
                {items.map((w) => (
                  <Link
                    key={w.id}
                    href={`/w/${w.id}`}
                    role="option"
                    aria-selected={w.id === current.id}
                    onClick={() => setOpen(false)}
                    className={clsx(
                      "flex items-center justify-between rounded-xl px-2.5 py-2 text-sm",
                      w.id === current.id ? "bg-lavender font-semibold text-primary" : "text-ink hover:bg-canvas",
                    )}
                  >
                    <span className="truncate">{w.name}</span>
                    {w.id === current.id && <Check className="size-4" aria-hidden />}
                  </Link>
                ))}
              </div>
            ))}
          </div>

          <div className="border-t border-line p-1.5">
            {creating ? (
              <form action={action} className="space-y-2 p-1.5">
                <input type="hidden" name="organizationId" value={current.organization.id} />
                <input
                  name="name"
                  autoFocus
                  required
                  maxLength={60}
                  placeholder={`New workspace in ${current.organization.name}`}
                  className="h-9 w-full rounded-lg border border-line px-2.5 text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 focus:outline-none"
                />
                {state.error && <p className="text-xs text-danger">{state.error}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={pending}
                    className="h-8 flex-1 rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                  >
                    {pending ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="h-8 rounded-lg px-3 text-xs text-muted hover:bg-canvas"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-primary hover:bg-lavender"
              >
                <Plus className="size-4" aria-hidden /> New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
