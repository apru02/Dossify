import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery, toPgVector } from "@/lib/ai/embed";
import type { SourceChunk } from "./prompt";

type MatchRow = {
  chunk_id: number;
  document_id: string;
  document_name: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  section: string | null;
  content: string;
  similarity: number;
};

/**
 * Vector search scoped to ONE workspace. The workspace filter lives inside the SQL function
 * (match_document_chunks), and the function runs as the calling user, so RLS applies too.
 */
export async function retrieveChunks(
  supabase: SupabaseClient,
  workspaceId: string,
  question: string,
  { k = 8, minSimilarity = 0.45 } = {},
): Promise<SourceChunk[]> {
  const embedding = await embedQuery(question);
  const { data, error } = await supabase.rpc("match_document_chunks", {
    p_workspace_id: workspaceId,
    p_query_embedding: toPgVector(embedding),
    p_match_count: k,
    p_min_similarity: minSimilarity,
  });
  if (error) throw error;

  return ((data ?? []) as MatchRow[]).map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentName: r.document_name,
    chunkIndex: r.chunk_index,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    section: r.section,
    content: r.content,
    similarity: r.similarity,
  }));
}
