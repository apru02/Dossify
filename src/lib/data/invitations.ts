import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PendingInvitation = {
  id: string;
  email: string;
  role: "admin" | "member";
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

type Raw = { id: string; email: string; role: "admin" | "member"; invited_by: string | null; created_at: string; expires_at: string };

// Open (not accepted, not revoked) invitations. RLS: owners/admins only; others get [].
export async function listPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, email, role, invited_by, created_at, expires_at")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .returns<Raw[]>();
  if (error) throw error;
  const now = Date.now();
  return data.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invited_by,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    expired: new Date(i.expires_at).getTime() < now,
  }));
}
