"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNext, siteUrl } from "@/lib/urls";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  notice?: string;
  values?: Record<string, string>;
};

const accountSchema = z
  .object({
    kind: z.enum(["personal", "organization"], { message: "Choose an account type" }),
    orgName: z.string().trim().max(80, "Keep it under 80 characters").optional().default(""),
  })
  .refine((v) => v.kind === "personal" || v.orgName.length >= 2, {
    path: ["orgName"],
    message: "Enter your organization's name",
  });

const signUpSchema = z.intersection(
  accountSchema,
  z.object({
    fullName: z.string().trim().min(1, "Enter your name").max(80),
    email: z.email("Enter a valid email address"),
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
  }),
);

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

function text(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

function friendlyAuthError(code: string | undefined, fallback: string) {
  switch (code) {
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Log in instead.";
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Please confirm your email first. Check your inbox for the link.";
    case "weak_password":
      return "That password is too weak. Try a longer one.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a minute and try again.";
    default:
      return fallback;
  }
}

function onboardingPath(kind: string, orgName: string) {
  const q = new URLSearchParams({ type: kind });
  if (kind === "organization" && orgName) q.set("name", orgName);
  return `/onboarding?${q}`;
}

export async function signUpWithEmail(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const values = {
    kind: text(form, "kind"),
    orgName: text(form, "orgName"),
    fullName: text(form, "fullName"),
    email: text(form, "email"),
  };
  const parsed = signUpSchema.safeParse({ ...values, password: text(form, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const { kind, orgName, fullName, email, password } = parsed.data;
  const next = onboardingPath(kind, orgName);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Saved on the auth user; onboarding reads it as defaults.
      data: { full_name: fullName, account_type: kind, org_name: kind === "organization" ? orgName : null },
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: friendlyAuthError(error.code, error.message), values };

  // With "Confirm email" turned off in Supabase we get a session immediately.
  if (data.session) redirect(next);

  return { notice: `We sent a confirmation link to ${email}. Open it to finish setting up Dossify.`, values };
}

export async function logInWithEmail(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const values = { email: text(form, "email") };
  const parsed = loginSchema.safeParse({ ...values, password: text(form, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: friendlyAuthError(error.code, "Could not log you in. Please try again."), values };

  redirect(safeNext(text(form, "next")));
}

// Used by both pages. On /signup it carries the chosen account type through Google's round-trip.
export async function continueWithGoogle(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  let next = safeNext(text(form, "next"));

  if (text(form, "intent") === "signup") {
    const values = { kind: text(form, "kind"), orgName: text(form, "orgName") };
    const parsed = accountSchema.safeParse(values);
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
    next = onboardingPath(parsed.data.kind, parsed.data.orgName);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    return { error: "Google sign-in is unavailable right now. Is the Google provider enabled in Supabase?" };
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
