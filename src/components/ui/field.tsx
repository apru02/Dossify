import clsx from "clsx";
import type { InputHTMLAttributes, ReactNode } from "react";

export function Field({
  label,
  error,
  hint,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; error?: string; hint?: ReactNode }) {
  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={clsx(
          "h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-ink placeholder:text-muted/70 transition-colors",
          "focus:border-primary focus:ring-4 focus:ring-primary/10 focus:outline-none",
          error ? "border-danger" : "border-line",
        )}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormAlert({ tone = "error", children }: { tone?: "error" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "rounded-xl border px-3.5 py-3 text-sm",
        tone === "error" ? "border-danger/20 bg-danger/5 text-danger" : "border-primary/20 bg-lavender text-ink",
      )}
    >
      {children}
    </div>
  );
}
