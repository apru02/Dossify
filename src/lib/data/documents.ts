import "server-only";
import { createClient } from "@/lib/supabase/server";

export type DocumentStatus = "processing" | "ready" | "failed";

export type DocumentRow = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  pageCount: number | null;
  chunkCount: number;
  uploadedBy: string | null;
  createdAt: string;
};

type Raw = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  error: string | null;
  page_count: number | null;
  chunk_count: number;
  uploaded_by: string | null;
  created_at: string;
};

export async function listDocuments(workspaceId: string): Promise<DocumentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, name, mime_type, size_bytes, status, error, page_count, chunk_count, uploaded_by, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .returns<Raw[]>();
  if (error) throw error;
  return data.map((d) => ({
    id: d.id,
    name: d.name,
    mimeType: d.mime_type,
    sizeBytes: d.size_bytes,
    status: d.status,
    error: d.error,
    pageCount: d.page_count,
    chunkCount: d.chunk_count,
    uploadedBy: d.uploaded_by,
    createdAt: d.created_at,
  }));
}

export async function countReadyDocuments(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "ready");
  if (error) throw error;
  return count ?? 0;
}
