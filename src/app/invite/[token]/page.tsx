import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CircleAlert } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { getCurrentUser } from "@/lib/auth";
import { INVITE_TOKEN_RE, hashInviteToken } from "@/lib/invitations/tokens";
import { createClient } from "@/lib/supabase/server";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Join your team", robots: { index: false } };

type Invite = { organization_name: string; inviter_name: string; email: string; role: "admin" | "member"; status: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Logo size={36} />
      </div>
      <div className="w-full max-w-[460px] rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">{children}</div>
    </main>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-danger/10 text-danger">
        <CircleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <Link href="/dashboard" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
        Go to Dossify
      </Link>
    </Shell>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!INVITE_TOKEN_RE.test(token)) return <Problem title="Invalid invitation" body="This invitation link isn't valid. Check that you copied the whole link." />;

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invitation", { p_token_hash: hashInviteToken(token) });
  const invite = (data as Invite[] | null)?.[0];
  if (!invite) return <Problem title="Invalid invitation" body="This invitation link isn't valid. Check that you copied the whole link." />;

  if (invite.status === "accepted") return <Problem title="Invitation already used" body={`This invitation to ${invite.organization_name} has already been accepted.`} />;
  if (invite.status === "revoked") return <Problem title="Invitation cancelled" body={`This invitation was cancelled. Ask ${invite.inviter_name} for a new one.`} />;
  if (invite.status === "expired") return <Problem title="Invitation expired" body={`This invitation has expired. Ask ${invite.inviter_name} to resend it.`} />;

  const user = await getCurrentUser();
  const here = `/invite/${token}`;
  const emailMatches = user?.email?.toLowerCase() === invite.email;

  return (
    <Shell>
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-lavender text-primary">
        <Building2 className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">Join {invite.organization_name}</h1>
      <p className="mt-2 text-sm text-muted">
        <span className="font-medium text-ink">{invite.inviter_name}</span> invited{" "}
        <span className="font-medium text-ink">{invite.email}</span> to join {invite.organization_name} on Dossify as{" "}
        {invite.role === "admin" ? "an admin" : "a member"}.
      </p>

      <div className="mt-6">
        {!user ? (
          <div className="space-y-2">
            <Link
              href={`/signup?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`}
              className="flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Create an account to join
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(here)}`}
              className="flex h-11 items-center justify-center rounded-xl border border-line text-sm font-semibold hover:bg-canvas"
            >
              I already have an account
            </Link>
            <p className="pt-1 text-center text-xs text-muted">Use {invite.email} to accept this invitation.</p>
          </div>
        ) : emailMatches ? (
          <AcceptButton token={token} organizationName={invite.organization_name} />
        ) : (
          <div className="space-y-3">
            <p className="rounded-xl bg-canvas px-3 py-2.5 text-sm text-ink">
              You&apos;re signed in as <span className="font-semibold">{user.email}</span>, but this invitation is for{" "}
              <span className="font-semibold">{invite.email}</span>.
            </p>
            <form action={signOut}>
              <input type="hidden" name="next" value={here} />
              <button type="submit" className="flex h-11 w-full items-center justify-center rounded-xl border border-line text-sm font-semibold hover:bg-canvas">
                Sign out and use {invite.email}
              </button>
            </form>
          </div>
        )}
      </div>
    </Shell>
  );
}
