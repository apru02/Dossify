import { notFound } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { MobileDrawer } from "@/components/app/mobile-drawer";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { displayName, requireUser } from "@/lib/auth";
import { getWorkspace, listWorkspaces } from "@/lib/data/workspaces";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const user = await requireUser();
  // RLS: returns null unless the user is a member of this workspace's organization.
  // Not found (rather than forbidden) so we don't reveal which workspace ids exist.
  const [workspace, workspaces] = await Promise.all([getWorkspace(workspaceId), listWorkspaces()]);
  if (!workspace) notFound();

  const name = displayName(user);

  return (
    <div className="min-h-screen md:flex">
      <MobileDrawer topBar={<Logo size={28} href="/dashboard" />}>
        <div className="flex h-full flex-col gap-6 p-4">
          <div className="px-1 pt-1">
            <Logo size={30} href="/dashboard" />
          </div>

          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
          <SidebarNav workspaceId={workspace.id} showMembers={workspace.organization.kind === "organization"} />

          <div className="mt-auto flex items-center gap-3 rounded-2xl border border-line p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-white">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{name}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
            </span>
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-lavender hover:text-primary"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </MobileDrawer>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
