"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type CreateWorkspaceState = { error?: string };

const schema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(1, "Enter a name").max(60, "Keep it under 60 characters"),
});

export async function createWorkspace(_: CreateWorkspaceState, form: FormData): Promise<CreateWorkspaceState> {
  const user = await requireUser();
  const parsed = schema.safeParse({ organizationId: form.get("organizationId"), name: form.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  // RLS rejects the insert unless the user is a member of organizationId.
  const { data, error } = await supabase
    .from("workspaces")
    .insert({ organization_id: parsed.data.organizationId, name: parsed.data.name, created_by: user.id })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    console.error("createWorkspace failed", error.code, error.message);
    return { error: "Couldn't create the workspace." };
  }
  redirect(`/w/${data.id}`);
}
