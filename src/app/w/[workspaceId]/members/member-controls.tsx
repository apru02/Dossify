"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, LogOut, Mail, RotateCw, Send, UserMinus, X } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";
import type { OrgRole } from "@/lib/data/workspaces";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  resendInvitation,
  revokeInvitation,
  type InviteResult,
} from "./actions";

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-white p-1 pl-3">
      <input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent text-xs text-muted focus:outline-none" />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-lavender px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-white"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function ResultNote({ result }: { result: InviteResult }) {
  return (
    <div className={clsx("space-y-2 rounded-2xl border px-4 py-3", result.ok ? "border-success/20 bg-success/5" : "border-danger/20 bg-danger/5")}>
      <p className={clsx("text-sm", result.ok ? "text-ink" : "text-danger")}>{result.message}</p>
      {result.link && <CopyLink link={result.link} />}
      {result.link && <p className="text-[11px] text-muted">Anyone with this link can see the invite, but only the invited email address can accept it. It expires in 7 days.</p>}
    </div>
  );
}

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: InviteResult, form: FormData) => {
    const res = await inviteMember(prev, form);
    if (res.ok) formRef.current?.reset();
    return res;
  }, {} as InviteResult);

  return (
    <div className="space-y-3">
      <form ref={formRef} action={action} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Email address</span>
          <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            name="email"
            type="email"
            required
            placeholder="teammate@company.com"
            className="h-11 w-full rounded-xl border border-line bg-white pr-3 pl-9 text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 focus:outline-none"
          />
        </label>
        <select
          name="role"
          defaultValue="member"
          aria-label="Role"
          className="h-11 rounded-xl border border-line bg-white px-3 text-sm focus:border-primary focus:outline-none"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send invite
        </button>
      </form>
      {state.message && <ResultNote result={state} />}
    </div>
  );
}

export function InvitationActions({ workspaceId, invitationId, email }: { workspaceId: string; invitationId: string; email: string }) {
  const [result, setResult] = useState<InviteResult | null>(null);
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const [, startTransition] = useTransition();

  const run = (kind: "resend" | "revoke") => {
    if (kind === "revoke" && !confirm(`Revoke the invitation for ${email}? The link will stop working.`)) return;
    setBusy(kind);
    startTransition(async () => {
      const res =
        kind === "resend"
          ? await resendInvitation({ workspaceId, invitationId })
          : await revokeInvitation({ workspaceId, invitationId });
      setResult(res);
      setBusy(null);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <button type="button" onClick={() => run("resend")} disabled={busy !== null} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-lavender disabled:opacity-50">
          {busy === "resend" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Resend
        </button>
        <button type="button" onClick={() => run("revoke")} disabled={busy !== null} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50">
          {busy === "revoke" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Revoke
        </button>
      </div>
      {result && result.link && <ResultNote result={result} />}
      {result && !result.ok && <p className="text-xs text-danger">{result.message}</p>}
    </div>
  );
}

export function MemberRoleControl({
  workspaceId,
  userId,
  role,
  canManage,
  isSelf,
  memberName,
}: {
  workspaceId: string;
  userId: string;
  role: OrgRole;
  canManage: boolean;
  isSelf: boolean;
  memberName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (role === "owner") {
    return <span className="rounded-full bg-lavender px-2.5 py-1 text-xs font-semibold text-primary">Owner</span>;
  }

  const change = (next: string) =>
    startTransition(async () => {
      setError(null);
      const res = await changeMemberRole({ workspaceId, userId, role: next });
      if (!res.ok) setError(res.message);
    });

  const remove = () => {
    const prompt = isSelf ? "Leave this organization? You'll lose access to all of its workspaces." : `Remove ${memberName}? They'll lose access to all of this organization's workspaces.`;
    if (!confirm(prompt)) return;
    startTransition(async () => {
      const res = await removeMember({ workspaceId, userId });
      if (!res.ok) return setError(res.message);
      if (res.left) router.push("/dashboard");
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {canManage && !isSelf ? (
          <select
            value={role}
            onChange={(e) => change(e.target.value)}
            disabled={pending}
            aria-label={`Role for ${memberName}`}
            className="h-8 rounded-lg border border-line bg-white px-2 text-xs capitalize focus:border-primary focus:outline-none"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        ) : (
          <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-muted capitalize">{role}</span>
        )}
        {(isSelf || canManage) && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={isSelf ? "Leave organization" : `Remove ${memberName}`}
            title={isSelf ? "Leave organization" : "Remove member"}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : isSelf ? <LogOut className="size-4" /> : <UserMinus className="size-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
