"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { displayName, requireUser } from "@/lib/auth";
import { getMyRole, getWorkspace, listMembers } from "@/lib/data/workspaces";
import { sendEmail } from "@/lib/email/mailer";
import { inviteEmail } from "@/lib/email/templates";
import { inviteLink, newInviteToken } from "@/lib/invitations/tokens";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/urls";

export type InviteResult = { ok: boolean; message: string; link?: string; emailSent?: boolean };
export type MemberActionResult = { ok: boolean; message: string; left?: boolean };

const MAX_OPEN_INVITES = 50;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The organization is always derived from a workspace the user can access (RLS), never taken
// from the client. Admin-only actions also require an owner/admin role in a team account.
async function context(workspaceId: unknown, { admin }: { admin: boolean }) {
  const user = await requireUser();
  const id = z.uuid().safeParse(workspaceId);
  if (!id.success) return null;
  const workspace = await getWorkspace(id.data);
  if (!workspace || workspace.organization.kind !== "organization") return null;
  const role = await getMyRole(workspace.organization.id, user.id);
  if (admin && role !== "owner" && role !== "admin") return null;
  return { user, workspace, org: workspace.organization, role };
}

async function deliverInvite(opts: {
  email: string;
  token: string;
  role: "admin" | "member";
  expiresAt: string;
  inviterName: string;
  organizationName: string;
}) {
  const base = await siteUrl();
  const link = inviteLink(base, opts.token);
  const result = await sendEmail({
    to: opts.email,
    ...inviteEmail({
      inviterName: opts.inviterName,
      organizationName: opts.organizationName,
      role: opts.role,
      link,
      expiresAt: new Date(opts.expiresAt),
      siteUrl: base,
    }),
  });
  const message = result.sent
    ? `Invitation emailed to ${opts.email}.`
    : result.reason === "not_configured"
      ? `Invitation created. Email isn't set up on this deployment yet, so copy the link below and send it to ${opts.email}.`
      : `Invitation created, but the email couldn't be sent. Copy the link below and send it to ${opts.email}.`;
  return { link, emailSent: result.sent, message };
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email address").transform((e) => e.trim().toLowerCase()),
  role: z.enum(["admin", "member"]),
});

export async function inviteMember(_: InviteResult, form: FormData): Promise<InviteResult> {
  const ctx = await context(form.get("workspaceId"), { admin: true });
  if (!ctx) return { ok: false, message: "Only owners and admins of a team account can invite people." };

  const parsed = inviteSchema.safeParse({ email: String(form.get("email") ?? "").trim(), role: form.get("role") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { email, role } = parsed.data;

  const members = await listMembers(ctx.org.id);
  if (members.some((m) => m.email?.toLowerCase() === email)) {
    return { ok: false, message: `${email} is already a member of ${ctx.org.name}.` };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("organization_invitations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.org.id)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_OPEN_INVITES) {
    return { ok: false, message: `You have ${MAX_OPEN_INVITES} open invitations. Revoke some before inviting more.` };
  }

  const { token, hash } = newInviteToken();
  const { data, error } = await supabase
    .from("organization_invitations")
    .insert({ organization_id: ctx.org.id, email, role, token_hash: hash })
    .select("expires_at")
    .single<{ expires_at: string }>();
  if (error?.code === "23505") {
    return { ok: false, message: `${email} already has a pending invitation. Use "Resend" below.` };
  }
  if (error) {
    console.error("inviteMember failed", error.code, error.message);
    return { ok: false, message: "Couldn't create the invitation." };
  }

  const delivered = await deliverInvite({
    email,
    token,
    role,
    expiresAt: data.expires_at,
    inviterName: displayName(ctx.user),
    organizationName: ctx.org.name,
  });
  revalidatePath(`/w/${ctx.workspace.id}/members`);
  return { ok: true, ...delivered };
}

const invitationRef = z.object({ workspaceId: z.uuid(), invitationId: z.uuid() });

// Resending rotates the token (old links stop working) and restarts the 7-day window.
export async function resendInvitation(input: { workspaceId: string; invitationId: string }): Promise<InviteResult> {
  const parsed = invitationRef.safeParse(input);
  const ctx = parsed.success ? await context(parsed.data.workspaceId, { admin: true }) : null;
  if (!parsed.success || !ctx) return { ok: false, message: "Only owners and admins can manage invitations." };

  const { token, hash } = newInviteToken();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .update({ token_hash: hash, expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(), invited_by: ctx.user.id })
    .eq("id", parsed.data.invitationId)
    .eq("organization_id", ctx.org.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("email, role, expires_at")
    .maybeSingle<{ email: string; role: "admin" | "member"; expires_at: string }>();
  if (error || !data) {
    if (error) console.error("resendInvitation failed", error.code, error.message);
    return { ok: false, message: "That invitation is no longer open." };
  }

  const delivered = await deliverInvite({
    email: data.email,
    token,
    role: data.role,
    expiresAt: data.expires_at,
    inviterName: displayName(ctx.user),
    organizationName: ctx.org.name,
  });
  revalidatePath(`/w/${ctx.workspace.id}/members`);
  return { ok: true, ...delivered };
}

export async function revokeInvitation(input: { workspaceId: string; invitationId: string }): Promise<MemberActionResult> {
  const parsed = invitationRef.safeParse(input);
  const ctx = parsed.success ? await context(parsed.data.workspaceId, { admin: true }) : null;
  if (!parsed.success || !ctx) return { ok: false, message: "Only owners and admins can manage invitations." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.invitationId)
    .eq("organization_id", ctx.org.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "That invitation is no longer open." };
  revalidatePath(`/w/${ctx.workspace.id}/members`);
  return { ok: true, message: "Invitation revoked. The link no longer works." };
}

const memberRef = z.object({ workspaceId: z.uuid(), userId: z.uuid() });

export async function changeMemberRole(input: { workspaceId: string; userId: string; role: string }): Promise<MemberActionResult> {
  const parsed = memberRef.extend({ role: z.enum(["admin", "member"]) }).safeParse(input);
  const ctx = parsed.success ? await context(parsed.data.workspaceId, { admin: true }) : null;
  if (!parsed.success || !ctx) return { ok: false, message: "Only owners and admins can change roles." };

  const supabase = await createClient();
  // RLS: can't change the owner's role or create a second owner.
  const { data, error } = await supabase
    .from("organization_members")
    .update({ role: parsed.data.role })
    .eq("organization_id", ctx.org.id)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error || !data?.length) return { ok: false, message: "That member's role can't be changed." };
  revalidatePath(`/w/${ctx.workspace.id}/members`);
  return { ok: true, message: "Role updated." };
}

export async function removeMember(input: { workspaceId: string; userId: string }): Promise<MemberActionResult> {
  const parsed = memberRef.safeParse(input);
  const ctx = parsed.success ? await context(parsed.data.workspaceId, { admin: false }) : null;
  if (!parsed.success || !ctx) return { ok: false, message: "Member not found." };

  const leaving = parsed.data.userId === ctx.user.id;
  if (!leaving && ctx.role !== "owner" && ctx.role !== "admin") {
    return { ok: false, message: "Only owners and admins can remove members." };
  }

  const supabase = await createClient();
  // RLS: nobody can remove the owner; members can only remove themselves.
  const { data, error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", ctx.org.id)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error || !data?.length) {
    return { ok: false, message: leaving ? "The owner can't leave their own organization." : "That member can't be removed." };
  }
  if (leaving) return { ok: true, left: true, message: `You left ${ctx.org.name}.` };
  revalidatePath(`/w/${ctx.workspace.id}/members`);
  return { ok: true, message: "Member removed. They no longer have access to this organization's workspaces." };
}
