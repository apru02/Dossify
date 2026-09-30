import type { SourceChunk } from "./prompt";

/*
 * Which retrieved chunks go to the LLM, and whether to call it at all.
 *
 * Calibrated with gemini-embedding-001 @ 768 dims on sample HR/project docs:
 *   answerable questions   → best similarity 0.69–0.78
 *   off-topic questions    → 0.50–0.57  (World Cup, wifi password, stock price)
 *   near-topic, unanswered → ~0.64      ("parental leave for adoption" vs. a leave policy)
 * So a similarity gate alone can't separate the last group. The gate (0.60) cheaply refuses
 * clearly off-topic questions without calling the LLM; the grounded prompt handles near misses.
 */
export const MIN_BEST_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.6);

export function selectContext(
  retrieved: SourceChunk[],
  { minBest = MIN_BEST_SIMILARITY, maxChunks = 6, window = 0.15, floor = 0.5 } = {},
): { context: SourceChunk[]; best: number } {
  const best = retrieved.reduce((m, c) => Math.max(m, c.similarity), 0);
  if (best < minBest) return { context: [], best };
  const cutoff = Math.max(floor, best - window);
  const context = [...retrieved]
    .sort((a, b) => b.similarity - a.similarity)
    .filter((c) => c.similarity >= cutoff)
    .slice(0, maxChunks);
  return { context, best };
}
