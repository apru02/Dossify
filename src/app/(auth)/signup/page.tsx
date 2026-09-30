import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { type, next, email } = await searchParams;
  // Coming from an invitation link: skip the account-type choice and return to the invite.
  const inviteNext = typeof next === "string" && /^\/invite\/[A-Za-z0-9_-]{43}$/.test(next) ? next : null;
  return (
    <SignupForm
      initialKind={type === "organization" ? "organization" : "personal"}
      inviteNext={inviteNext}
      defaultEmail={typeof email === "string" ? email.slice(0, 320) : undefined}
    />
  );
}
