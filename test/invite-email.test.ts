import { describe, expect, it } from "vitest";
import { inviteEmail } from "@/lib/email/templates";
import { INVITE_TOKEN_RE, hashInviteToken, inviteLink, newInviteToken } from "@/lib/invitations/tokens";

describe("invite tokens", () => {
  it("are 256-bit, URL-safe, unique, and stored only as a SHA-256 hash", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).toMatch(INVITE_TOKEN_RE);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(inviteLink("https://dossify.app", a.token)).toBe(`https://dossify.app/invite/${a.token}`);
  });
});

describe("invite email", () => {
  const base = { role: "member" as const, link: "https://dossify.app/invite/abc", expiresAt: new Date("2026-10-08T00:00:00Z"), siteUrl: "https://dossify.app" };

  it("includes who, where, the link and the expiry", () => {
    const mail = inviteEmail({ ...base, inviterName: "Priya Raman", organizationName: "Acme" });
    expect(mail.subject).toBe("Priya Raman invited you to join Acme on Dossify");
    expect(mail.html).toContain('href="https://dossify.app/invite/abc"');
    expect(mail.text).toContain("https://dossify.app/invite/abc");
    expect(mail.text).toContain("October 8, 2026");
  });

  it("escapes user-controlled names so they can't inject markup or links", () => {
    const mail = inviteEmail({
      ...base,
      inviterName: '<img src=x onerror="alert(1)">Eve',
      organizationName: '<a href="https://evil.example">Click here</a>',
    });
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).not.toContain('<a href="https://evil.example"');
    expect(mail.html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });

  it("keeps names on one line in the plain-text and subject", () => {
    const mail = inviteEmail({ ...base, inviterName: "Eve\nBcc: victim@x.com", organizationName: "Acme" });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text.split("\n")[0]).toContain("Eve Bcc: victim@x.com invited you");
  });
});
