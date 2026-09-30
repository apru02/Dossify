"use client";

import { Loader2, Send, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { disconnectSlack, sendSlackTestMessage, type SettingsActionResult } from "./actions";

export function SlackConnectedActions({ workspaceId }: { workspaceId: string }) {
  const [result, setResult] = useState<SettingsActionResult | null>(null);
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [, startTransition] = useTransition();

  const run = (kind: "test" | "disconnect") => {
    if (kind === "disconnect" && !confirm("Disconnect Slack? The assistant will no longer be able to post summaries.")) return;
    setBusy(kind);
    setResult(null);
    startTransition(async () => {
      const res = await (kind === "test" ? sendSlackTestMessage(workspaceId) : disconnectSlack(workspaceId)).catch(() => ({
        ok: false,
        message: "Network error.",
      }));
      setResult(res);
      setBusy(null);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run("test")}
          disabled={busy !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas disabled:opacity-60"
        >
          {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send test message
        </button>
        <button
          type="button"
          onClick={() => run("disconnect")}
          disabled={busy !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
        >
          {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />} Disconnect
        </button>
      </div>
      {result && <p className={result.ok ? "text-xs text-success" : "text-xs text-danger"}>{result.message}</p>}
    </div>
  );
}
