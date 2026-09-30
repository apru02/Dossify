"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { AccountTypePicker, type AccountKind } from "@/components/account-type-picker";
import { Button } from "@/components/ui/button";
import { Field, FormAlert } from "@/components/ui/field";
import { continueWithGoogle, signUpWithEmail, type AuthFormState } from "../actions";
import { GoogleButton, OrDivider } from "../google-button";

export function SignupForm({ initialKind }: { initialKind: AccountKind }) {
  const [state, emailAction, emailPending] = useActionState(signUpWithEmail, {} as AuthFormState);
  const [googleState, googleAction, googlePending] = useActionState(continueWithGoogle, {} as AuthFormState);
  const [kind, setKind] = useState<AccountKind>(initialKind);
  const busy = emailPending || googlePending;
  const fe = { ...googleState.fieldErrors, ...state.fieldErrors };
  const error = state.error ?? googleState.error;

  if (state.notice) {
    return (
      <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-card">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-lavender text-primary">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h2 className="text-xl font-semibold">Check your email</h2>
        <p className="mt-2 text-sm text-muted">{state.notice}</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
      <div className="mb-6 space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
        <p className="text-sm text-muted">Choose how you&apos;ll use Dossify. You can add more workspaces later.</p>
      </div>

      <form action={emailAction} className="space-y-5">
        <input type="hidden" name="intent" value="signup" />
        {error && <FormAlert>{error}</FormAlert>}

        <AccountTypePicker value={kind} onChange={setKind} error={fe.kind} />

        {kind === "organization" && (
          <Field
            id="orgName"
            name="orgName"
            label="Organization name"
            placeholder="Acme Inc."
            autoComplete="organization"
            required
            maxLength={80}
            defaultValue={state.values?.orgName ?? googleState.values?.orgName}
            error={fe.orgName}
          />
        )}

        <GoogleButton formAction={googleAction} loading={googlePending} disabled={busy} />
        <OrDivider label="or sign up with email" />

        <Field
          id="fullName"
          name="fullName"
          label="Full name"
          autoComplete="name"
          placeholder="Jane Doe"
          required
          maxLength={80}
          defaultValue={state.values?.fullName}
          error={fe.fullName}
        />
        <Field
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          defaultValue={state.values?.email}
          error={fe.email}
        />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          hint="At least 8 characters."
          error={fe.password}
        />

        <Button type="submit" loading={emailPending} disabled={busy} className="w-full">
          Create {kind === "organization" ? "organization" : "personal"} account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
