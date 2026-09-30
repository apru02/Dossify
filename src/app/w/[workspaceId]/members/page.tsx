import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getMyRole, getWorkspace, listMembers } from "@/lib/data/workspaces";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: PageProps<"/w/[workspaceId]/members">) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const workspace = await getWorkspace(workspaceId);
  // Personal accounts have exactly one member; the page doesn't apply.
  if (!workspace || workspace.organization.kind !== "organization") notFound();

  const [members, myRole] = await Promise.all([
    listMembers(workspace.organization.id),
    getMyRole(workspace.organization.id, user.id),
  ]);
  const canInvite = myRole === "owner" || myRole === "admin";

  return (
    <>
      <PageHeader
        title="Members"
        description={`People in ${workspace.organization.name} can access all of its workspaces.`}
        actions={
          canInvite && (
            <Button disabled title="Invitations arrive in a later build step">
              <UserPlus className="size-4" aria-hidden /> Invite member
            </Button>
          )
        }
      />
      <div className="p-6 sm:p-10">
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {members.map((m) => {
            const label = m.fullName || m.email || "Unknown user";
            return (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-full bg-lavender text-sm font-semibold text-primary">
                  {label.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {label} {m.userId === user.id && <span className="font-normal text-muted">(you)</span>}
                  </span>
                  {m.fullName && m.email && <span className="block truncate text-xs text-muted">{m.email}</span>}
                </span>
                <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-muted capitalize">{m.role}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
