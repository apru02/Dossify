"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/data/workspaces";
import { ingestFile } from "@/lib/ingest/ingest";
import { createClient } from "@/lib/supabase/server";

export type UploadResult = { ok: boolean; message: string };

const ids = z.object({ workspaceId: z.uuid() });

export async function uploadDocument(form: FormData): Promise<UploadResult> {
  await requireUser();
  const parsed = ids.safeParse({ workspaceId: form.get("workspaceId") });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) return { ok: false, message: "Invalid upload." };

  // RLS: null unless the user can access this workspace. Never trust the id from the form.
  const workspace = await getWorkspace(parsed.data.workspaceId);
  if (!workspace) return { ok: false, message: "Workspace not found." };

  const supabase = await createClient();
  try {
    const result = await ingestFile(supabase, workspace.id, file);
    revalidatePath(`/w/${workspace.id}/documents`);
    switch (result.status) {
      case "created":
        return { ok: true, message: `Ready: split into ${result.chunkCount} searchable sections.` };
      case "reprocessed":
        return { ok: true, message: `Reprocessed: ${result.chunkCount} searchable sections.` };
      case "duplicate":
        return { ok: true, message: "Already in this workspace. Nothing was duplicated." };
      case "in_progress":
        return { ok: true, message: "This file is already being processed." };
      case "failed":
        return { ok: false, message: result.message };
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error("uploadDocument failed", { code: e.code, message: e.message });
    return { ok: false, message: "Upload failed. Please try again." };
  }
}

export async function deleteDocument(form: FormData): Promise<UploadResult> {
  await requireUser();
  const parsed = z.object({ workspaceId: z.uuid(), documentId: z.uuid() }).safeParse({
    workspaceId: form.get("workspaceId"),
    documentId: form.get("documentId"),
  });
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const supabase = await createClient();
  // RLS allows this only for the uploader or a workspace owner/admin; chunks cascade.
  const { data, error } = await supabase
    .from("documents")
    .delete()
    .eq("id", parsed.data.documentId)
    .eq("workspace_id", parsed.data.workspaceId)
    .select("id");
  if (error) {
    console.error("deleteDocument failed", error.code, error.message);
    return { ok: false, message: "Couldn't delete the document." };
  }
  if (!data?.length) return { ok: false, message: "Only the uploader or an admin can delete this document." };

  revalidatePath(`/w/${parsed.data.workspaceId}/documents`);
  return { ok: true, message: "Document deleted." };
}
