"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormAlert } from "@/components/ui/field";
import { continueWithGoogle, logInWithEmail, type AuthFormState } from "../actions";
import { GoogleButton, OrDivider } from "../google-button";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, emailAction, emailPending] = useActionState(logInWithEmail, {} as AuthFormState);
  const [googleState, googleAction, googlePending] = useActionState(continueWithGoogle, {} as AuthFormState);
  const busy = emailPending || googlePending;
  // The ?error= from a failed OAuth callback shows until the user submits again.
  const submitted = Boolean(state.values || state.error || googleState.error);
  const error = state.error ?? googleState.error ?? (submitted ? undefined : initialError);

  return (
    <div className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
      <div className="mb-6 space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
        <p className="text-sm text-muted">Log in to pick up where you left off.</p>
      </div>

      <form action={emailAction} className="space-y-5">
        <input type="hidden" name="next" value={next} />
        {error && <FormAlert>{error}</FormAlert>}

        <GoogleButton formAction={googleAction} loading={googlePending} disabled={busy} />
        <OrDivider label="or log in with email" />

        <Field
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
        />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password}
        />

        <Button type="submit" loading={emailPending} disabled={busy} className="w-full">
          Log in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New to Dossify?{" "}
        <Link
          href={next.startsWith("/invite/") ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className="font-semibold text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
