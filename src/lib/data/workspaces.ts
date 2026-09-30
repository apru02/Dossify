import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AccountKind = "personal" | "organization";
export type OrgRole = "owner" | "admin" | "member";

export type Organization = { id: string; name: string; kind: AccountKind };
export type Workspace = { id: string; name: string; organization: Organization };
export type Member = { userId: string; role: OrgRole; email: string | null; fullName: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

type WorkspaceRow = { id: string; name: string; organizations: Organization | null };

const toWorkspace = (r: WorkspaceRow): Workspace => ({ id: r.id, name: r.name, organization: r.organizations! });

// RLS returns only workspaces in organizations the user belongs to. No manual filter needed,
// but callers must still treat a missing row as "no access" (404), never as an error to retry.
export const listWorkspaces = cache(async (): Promise<Workspace[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, organizations!inner(id, name, kind)")
    .order("created_at", { ascending: true })
    .returns<WorkspaceRow[]>();
  if (error) throw error;
  return data.map(toWorkspace);
});

export const getWorkspace = cache(async (id: string): Promise<Workspace | null> => {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, organizations!inner(id, name, kind)")
    .eq("id", id)
    .returns<WorkspaceRow[]>()
    .maybeSingle();
  if (error) throw error;
  return data ? toWorkspace(data) : null;
});

export const getMyRole = cache(async (organizationId: string, userId: string): Promise<OrgRole | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<{ role: OrgRole }>();
  return data?.role ?? null;
});

export async function listMembers(organizationId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .returns<{ user_id: string; role: OrgRole }[]>();
  if (error) throw error;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", rows.map((r) => r.user_id))
    .returns<{ id: string; email: string | null; full_name: string | null }[]>();
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  return rows.map((r) => ({
    userId: r.user_id,
    role: r.role,
    email: byId.get(r.user_id)?.email ?? null,
    fullName: byId.get(r.user_id)?.full_name ?? null,
  }));
}
