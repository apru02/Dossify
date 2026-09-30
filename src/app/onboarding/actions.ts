"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string; fieldErrors?: Partial<Record<string, string>> };

const schema = z
  .object({
    kind: z.enum(["personal", "organization"], { message: "Choose an account type" }),
    orgName: z.string().trim().max(80, "Keep it under 80 characters").default(""),
    workspaceName: z.string().trim().min(1, "Name your first workspace").max(60, "Keep it under 60 characters"),
  })
  .refine((v) => v.kind === "personal" || v.orgName.length >= 2, {
    path: ["orgName"],
    message: "Enter your organization's name",
  });

export async function createAccount(_: OnboardingState, form: FormData): Promise<OnboardingState> {
  await requireUser();
  const parsed = schema.safeParse({
    kind: form.get("kind"),
    orgName: form.get("orgName") ?? "",
    workspaceName: form.get("workspaceName"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }

  const { kind, orgName, workspaceName } = parsed.data;
  const supabase = await createClient();
  // One transaction in Postgres: organization + owner membership + first workspace. Idempotent.
  const { data: workspaceId, error } = await supabase.rpc("create_account", {
    p_kind: kind,
    p_name: kind === "organization" ? orgName : null,
    p_workspace_name: workspaceName,
  });
  if (error || typeof workspaceId !== "string") {
    console.error("create_account failed", error?.code, error?.message);
    return { error: "We couldn't set up your account. Please try again." };
  }

  redirect(`/w/${workspaceId}`);
}
