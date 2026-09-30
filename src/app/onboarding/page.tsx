import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { displayName, requireUser } from "@/lib/auth";
import { listWorkspaces } from "@/lib/data/workspaces";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your account" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  if ((await listWorkspaces()).length > 0) redirect("/dashboard");

  // Defaults come from the signup choice: ?type=&name= (Google flow) or user metadata (email flow).
  const sp = await searchParams;
  const meta = user.user_metadata ?? {};
  const typeParam = typeof sp.type === "string" ? sp.type : meta.account_type;
  const kind = typeParam === "organization" ? "organization" : typeParam === "personal" ? "personal" : null;
  const orgName = (typeof sp.name === "string" ? sp.name : meta.org_name) ?? "";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Logo size={36} href={null} />
      </div>
      <div className="w-full max-w-[520px]">
        <OnboardingForm
          name={displayName(user)}
          email={user.email ?? ""}
          initialKind={kind}
          initialOrgName={String(orgName).slice(0, 80)}
        />
      </div>
    </main>
  );
}
