import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { listPendingInvitations } from "@/lib/data/invitations";
import { getMyRole, getWorkspace, listMembers } from "@/lib/data/workspaces";
import { smtpConfig } from "@/lib/email/mailer";
import { InvitationActions, InviteForm, MemberRoleControl } from "./member-controls";

export const metadata: Metadata = { title: "Members" };

function relativeDays(iso: string) {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

export default async function MembersPage({ params }: PageProps<"/w/[workspaceId]/members">) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const workspace = await getWorkspace(workspaceId);
  // Personal accounts have exactly one member; the page doesn't apply.
  if (!workspace || workspace.organization.kind !== "organization") notFound();

  const org = workspace.organization;
  const [members, myRole] = await Promise.all([listMembers(org.id), getMyRole(org.id, user.id)]);
  const isAdmin = myRole === "owner" || myRole === "admin";
  const invitations = isAdmin ? await listPendingInvitations(org.id) : [];
  const nameOf = new Map(members.map((m) => [m.userId, m.fullName || m.email || "A teammate"]));
  const roleOrder = { owner: 0, admin: 1, member: 2 } as const;
  const sorted = [...members].sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || (nameOf.get(a.userId) ?? "").localeCompare(nameOf.get(b.userId) ?? ""));

  return (
    <>
      <PageHeader title="Members" description={`People in ${org.name} can access all of its workspaces.`} />
      <div className="mx-auto max-w-4xl space-y-8 p-6 sm:p-10">
        {isAdmin && (
          <section className="rounded-3xl border border-line bg-white p-6 shadow-card">
            <h2 className="flex items-center gap-2 font-semibold">
              <UserPlus className="size-4 text-primary" aria-hidden /> Invite people
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              They&apos;ll get an email with a link to join {org.name}. Admins can invite others and manage members.
              {!smtpConfig() && " Email isn't set up on this deployment, so you'll get a link to share instead."}
            </p>
            <InviteForm workspaceId={workspace.id} />
          </section>
        )}

        {isAdmin && invitations.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Pending invitations ({invitations.length})</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-dashed border-line text-muted">
                    <Clock className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{i.email}</p>
                    <p className="text-xs text-muted">
                      <span className="capitalize">{i.role}</span> · invited by {i.invitedBy === user.id ? "you" : (nameOf.get(i.invitedBy ?? "") ?? "a former member")} ·{" "}
                      {i.expired ? <span className="text-danger">expired, resend to renew</span> : `expires ${relativeDays(i.expiresAt)}`}
                    </p>
                  </div>
                  <InvitationActions workspaceId={workspace.id} invitationId={i.id} email={i.email} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Members ({members.length})</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {sorted.map((m) => {
              const label = nameOf.get(m.userId)!;
              return (
                <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lavender text-sm font-semibold text-primary">
                    {label.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {label} {m.userId === user.id && <span className="font-normal text-muted">(you)</span>}
                    </span>
                    {m.fullName && m.email && <span className="block truncate text-xs text-muted">{m.email}</span>}
                  </span>
                  <MemberRoleControl
                    workspaceId={workspace.id}
                    userId={m.userId}
                    role={m.role}
                    canManage={isAdmin}
                    isSelf={m.userId === user.id}
                    memberName={label}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
