"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { INVITE_TOKEN_RE, hashInviteToken } from "@/lib/invitations/tokens";
import { createClient } from "@/lib/supabase/server";

const ERRORS: Record<string, string> = {
  invitation_not_found: "This invitation link isn't valid.",
  invitation_revoked: "This invitation was cancelled. Ask for a new one.",
  invitation_expired: "This invitation has expired. Ask the person who invited you to resend it.",
  invitation_used: "This invitation has already been used.",
  invitation_email_mismatch: "This invitation was sent to a different email address. Sign in with that address to accept it.",
};

export async function acceptInvitation(token: string): Promise<{ ok: false; message: string }> {
  await requireUser();
  if (!INVITE_TOKEN_RE.test(token)) return { ok: false, message: ERRORS.invitation_not_found };

  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("accept_invitation", { p_token_hash: hashInviteToken(token) });
  if (error) {
    const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
    if (!code) console.error("accept_invitation failed", error.code, error.message);
    return { ok: false, message: code ? ERRORS[code] : "Couldn't accept the invitation. Please try again." };
  }
  redirect(typeof workspaceId === "string" ? `/w/${workspaceId}` : "/dashboard");
}
