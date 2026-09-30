"use client";

import { useActionState, useState } from "react";
import { AccountTypePicker, type AccountKind } from "@/components/account-type-picker";
import { Button } from "@/components/ui/button";
import { Field, FormAlert } from "@/components/ui/field";
import { signOut } from "../(auth)/actions";
import { createAccount, type OnboardingState } from "./actions";

export function OnboardingForm({
  name,
  email,
  initialKind,
  initialOrgName,
}: {
  name: string;
  email: string;
  initialKind: AccountKind | null;
  initialOrgName: string;
}) {
  const [state, action, pending] = useActionState(createAccount, {} as OnboardingState);
  const [kind, setKind] = useState<AccountKind>(initialKind ?? "personal");
  const fe = state.fieldErrors ?? {};

  return (
    <div className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name.split(" ")[0]} 👋</h1>
        <p className="text-sm text-muted">
          Let&apos;s set up your account. You&apos;re signed in as <span className="font-medium text-ink">{email}</span>.
        </p>
      </div>

      <form action={action} className="space-y-5">
        {state.error && <FormAlert>{state.error}</FormAlert>}

        <AccountTypePicker value={kind} onChange={setKind} error={fe.kind} />

        {kind === "organization" && (
          <Field
            id="orgName"
            name="orgName"
            label="Organization name"
            placeholder="Acme Inc."
            required
            maxLength={80}
            defaultValue={initialOrgName}
            error={fe.orgName}
          />
        )}

        <Field
          id="workspaceName"
          name="workspaceName"
          label="First workspace"
          placeholder={kind === "organization" ? "Product Team" : "My Documents"}
          defaultValue={kind === "organization" ? "General" : "My Documents"}
          key={kind}
          required
          maxLength={60}
          hint="Workspaces keep documents and chats separate. You can create more later."
          error={fe.workspaceName}
        />

        <Button type="submit" loading={pending} className="w-full">
          Continue to Dossify
        </Button>
      </form>

      <form action={signOut} className="mt-4 text-center">
        <button type="submit" className="text-xs text-muted hover:text-primary">
          Not you? Sign out
        </button>
      </form>
    </div>
  );
}
