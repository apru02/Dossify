import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

// Transactional email over SMTP, so any provider works (Gmail app password, Brevo, Resend SMTP…).
// Not configured → sendEmail returns { sent: false } and callers fall back to "copy the link".

type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string };

export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM?.trim() || user;
  if (!host || !user || !pass || !from) return null;
  return { host, user, pass, from, port: Number(process.env.SMTP_PORT ?? 587) };
}

let transporter: Transporter | null = null;
function transport(cfg: SmtpConfig): Transporter {
  transporter ??= nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

export type EmailResult = { sent: true } | { sent: false; reason: "not_configured" | "failed" };

export async function sendEmail(message: { to: string; subject: string; html: string; text: string }): Promise<EmailResult> {
  const cfg = smtpConfig();
  if (!cfg) return { sent: false, reason: "not_configured" };
  try {
    await transport(cfg).sendMail({ from: cfg.from, ...message });
    return { sent: true };
  } catch (e) {
    // Never log credentials; the message is enough to debug (auth failure, connection refused…).
    console.error("sendEmail failed", { to: message.to, error: (e as Error)?.message });
    return { sent: false, reason: "failed" };
  }
}
