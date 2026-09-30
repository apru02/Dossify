import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedDocuments, toPgVector } from "@/lib/ai/embed";
import { chunkSegments, type Chunk } from "./chunk";
import { MAX_FILE_BYTES, UnsupportedFileError, parseFile } from "./parse";

const MAX_CHUNKS = 250; // ~125k tokens; keeps one upload inside free-tier embedding limits and 60s
const STALE_PROCESSING_MS = 5 * 60 * 1000; // a "processing" row older than this was interrupted
const INSERT_BATCH = 100;

export type IngestResult =
  | { status: "created" | "reprocessed"; documentId: string; chunkCount: number }
  | { status: "duplicate" | "in_progress"; documentId: string }
  | { status: "failed"; documentId?: string; message: string };

type ExistingDoc = { id: string; status: "processing" | "ready" | "failed"; updated_at: string };

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || "document";
}

// Text sent to the embedding model gets a small header so chunks from different files and
// sections are distinguishable ("contextual chunk headers"). The stored content stays clean.
function embeddingInput(docName: string, c: Chunk) {
  const header = [`Document: ${docName}`, c.section && `Section: ${c.section}`].filter(Boolean).join("\n");
  return `${header}\n\n${c.content}`;
}

/**
 * Ingest one uploaded file into a workspace. Idempotent by content hash:
 *   - same file already ready     → "duplicate", nothing written
 *   - same file currently running → "in_progress"
 *   - same file previously failed / interrupted → reprocessed in place (old chunks replaced)
 *
 * `supabase` must be the user-scoped client (RLS enforces workspace access on every write), and
 * the caller must already have loaded `workspaceId` through RLS.
 */
export async function ingestFile(
  supabase: SupabaseClient,
  workspaceId: string,
  file: File,
): Promise<IngestResult> {
  if (file.size === 0) return { status: "failed", message: "This file is empty." };
  if (file.size > MAX_FILE_BYTES) return { status: "failed", message: "Files must be 4 MB or smaller." };

  const name = sanitizeFileName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(bytes).digest("hex");

  // 1. Claim a documents row (or discover it already exists).
  const { data: existing, error: lookupError } = await supabase
    .from("documents")
    .select("id, status, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("content_hash", contentHash)
    .maybeSingle<ExistingDoc>();
  if (lookupError) throw lookupError;

  let documentId: string;
  let reprocessing = false;

  if (existing) {
    const stale = Date.now() - new Date(existing.updated_at).getTime() > STALE_PROCESSING_MS;
    if (existing.status === "ready") return { status: "duplicate", documentId: existing.id };
    if (existing.status === "processing" && !stale) return { status: "in_progress", documentId: existing.id };

    documentId = existing.id;
    reprocessing = true;
    const { error } = await supabase
      .from("documents")
      .update({ status: "processing", error: null, name, size_bytes: file.size, chunk_count: 0 })
      .eq("id", documentId);
    if (error) throw error;
    const { error: delError } = await supabase.from("document_chunks").delete().eq("document_id", documentId);
    if (delError) throw delError;
  } else {
    const { data, error } = await supabase
      .from("documents")
      .insert({
        workspace_id: workspaceId,
        name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        content_hash: contentHash,
      })
      .select("id")
      .single<{ id: string }>();
    if (error?.code === "23505") {
      // Lost a race with a concurrent upload of the same file.
      return { status: "in_progress", documentId: "" };
    }
    if (error) throw error;
    documentId = data.id;
  }

  // 2. Parse → chunk → embed → store. Any failure marks the row failed (retry = upload again).
  try {
    const parsed = await parseFile(name, bytes);
    const chunks = chunkSegments(parsed.segments);
    if (chunks.length === 0) throw new UnsupportedFileError("No readable text found in this file.");
    if (chunks.length > MAX_CHUNKS) {
      throw new UnsupportedFileError(`This file is too long (${chunks.length} sections). Split it into smaller files.`);
    }

    const vectors = await embedDocuments(chunks.map((c) => embeddingInput(name, c)));

    const rows = chunks.map((c, i) => ({
      workspace_id: workspaceId,
      document_id: documentId,
      chunk_index: c.index,
      content: c.content,
      page_start: c.pageStart,
      page_end: c.pageEnd,
      section: c.section,
      token_count: c.tokenCount,
      embedding: toPgVector(vectors[i]),
    }));
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const { error } = await supabase.from("document_chunks").insert(rows.slice(i, i + INSERT_BATCH));
      if (error) throw error;
    }

    const { error } = await supabase
      .from("documents")
      .update({ status: "ready", mime_type: parsed.mimeType, page_count: parsed.pageCount, chunk_count: chunks.length })
      .eq("id", documentId);
    if (error) throw error;

    return { status: reprocessing ? "reprocessed" : "created", documentId, chunkCount: chunks.length };
  } catch (err) {
    const message =
      err instanceof UnsupportedFileError
        ? err.message
        : "Processing failed (the AI service may be busy). Upload the same file again to retry.";
    if (!(err instanceof UnsupportedFileError)) {
      const e = err as { code?: string; status?: number; message?: string };
      console.error("ingest failed", { documentId, code: e.code, status: e.status, message: e.message });
    }
    await supabase.from("documents").update({ status: "failed", error: message }).eq("id", documentId);
    return { status: "failed", documentId, message };
  }
}
