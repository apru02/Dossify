"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { acceptInvitation } from "./actions";

export function AcceptButton({ token, organizationName }: { token: string; organizationName: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await acceptInvitation(token); // redirects on success
            if (res && !res.ok) setError(res.message);
          })
        }
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />} Join {organizationName}
      </button>
      {error && <p className="rounded-xl bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
