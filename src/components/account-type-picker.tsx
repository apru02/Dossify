"use client";

import clsx from "clsx";
import { Building2, Check, User } from "lucide-react";

export type AccountKind = "personal" | "organization";

const options: { value: AccountKind; title: string; body: string; icon: typeof User }[] = [
  { value: "personal", title: "Personal", body: "Just you. Private workspaces for your own documents.", icon: User },
  { value: "organization", title: "Organization", body: "Shared workspaces. Invite your team to collaborate.", icon: Building2 },
];

// Radio group styled as cards. Submits as `kind`.
export function AccountTypePicker({
  value,
  onChange,
  error,
}: {
  value: AccountKind;
  onChange: (v: AccountKind) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">Account type</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(({ value: v, title, body, icon: Icon }) => {
          const selected = value === v;
          return (
            <label
              key={v}
              className={clsx(
                "relative flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition-all",
                "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary/15",
                selected ? "border-primary bg-lavender/60 shadow-card" : "border-line bg-white hover:border-secondary/60",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={v}
                checked={selected}
                onChange={() => onChange(v)}
                className="sr-only"
              />
              <span className="flex items-center justify-between">
                <span
                  className={clsx(
                    "grid size-9 place-items-center rounded-xl",
                    selected ? "bg-primary text-white" : "bg-canvas text-primary",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <span
                  className={clsx(
                    "grid size-5 place-items-center rounded-full border",
                    selected ? "border-primary bg-primary text-white" : "border-line",
                  )}
                >
                  {selected && <Check className="size-3" strokeWidth={3} aria-hidden />}
                </span>
              </span>
              <span className="text-sm font-semibold text-ink">{title}</span>
              <span className="text-xs leading-relaxed text-muted">{body}</span>
            </label>
          );
        })}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
