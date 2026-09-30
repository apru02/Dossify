// Email templates. Every user-controlled value (names, organization) is HTML-escaped: an
// organization called "<a href=evil>" must not turn into a link in someone's inbox.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Plain-text parts can't render markup, but strip line breaks so a name can't forge extra lines.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function inviteEmail(opts: {
  inviterName: string;
  organizationName: string;
  role: "admin" | "member";
  link: string;
  expiresAt: Date;
  siteUrl: string;
}) {
  const inviter = oneLine(opts.inviterName).slice(0, 80);
  const org = oneLine(opts.organizationName).slice(0, 80);
  const expires = opts.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const roleText = opts.role === "admin" ? "an admin" : "a member";
  const subject = `${inviter} invited you to join ${org} on Dossify`;

  const text = [
    `${inviter} invited you to join ${org} on Dossify as ${roleText}.`,
    "",
    "Dossify is an AI document assistant: ask questions about your team's documents, get cited answers, and take action.",
    "",
    `Accept the invitation: ${opts.link}`,
    "",
    `This link expires on ${expires}. Sign in with this email address to accept it.`,
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F5F7FF;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0F172A">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E4E7F2;border-radius:20px;padding:32px">
          <tr><td>
            <img src="${escapeHtml(opts.siteUrl)}/brand/dossify-icon.png" width="40" height="40" alt="Dossify" style="display:block;margin-bottom:24px">
            <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">Join ${escapeHtml(org)} on Dossify</h1>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">
              <strong>${escapeHtml(inviter)}</strong> invited you to join <strong>${escapeHtml(org)}</strong> as ${roleText}.
              Ask questions about your team's documents, get cited answers, and take action, all in one workspace.
            </p>
            <p style="margin:24px 0">
              <a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#6C3DF5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">Accept invitation</a>
            </p>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748B">
              This link expires on ${escapeHtml(expires)}. Sign in with this email address to accept it.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#64748B;word-break:break-all">
              Or paste this link into your browser: ${escapeHtml(opts.link)}
            </p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#64748B">If you weren't expecting this invitation, you can ignore this email.</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
