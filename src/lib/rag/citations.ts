import { NO_ANSWER, pageLabel, type SourceChunk } from "./prompt";

export type Citation = {
  n: number; // the [n] used in the answer text
  chunkId: number;
  documentId: string;
  documentName: string;
  pages: string | null;
  section: string | null;
  snippet: string;
  similarity: number;
};

const CITE_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export function citedNumbers(answer: string): number[] {
  const seen = new Set<number>();
  for (const m of answer.matchAll(CITE_RE)) {
    for (const n of m[1].split(",")) seen.add(Number(n.trim()));
  }
  return [...seen].sort((a, b) => a - b);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

// The exact refusal sentence, or a short uncited "I don't know…" reply. An answer that cites
// sources is never a refusal, even if it starts with "I don't know the exact date, but…".
export function isNoAnswer(answer: string): boolean {
  const a = norm(answer);
  if (a.startsWith(norm(NO_ANSWER).slice(0, 40))) return true;
  return a.startsWith("i dont know") && citedNumbers(answer).length === 0 && a.length < 200;
}

// Drop citation markers that point at sources we never gave the model (hallucinated numbers).
export function removeInvalidCitations(answer: string, sourceCount: number): string {
  return answer.replace(CITE_RE, (full, nums: string) => {
    const valid = nums
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => n >= 1 && n <= sourceCount);
    return valid.length ? `[${valid.join(", ")}]` : "";
  });
}

export function buildCitations(answer: string, sources: SourceChunk[]): Citation[] {
  if (isNoAnswer(answer)) return [];
  return citedNumbers(answer)
    .filter((n) => n >= 1 && n <= sources.length)
    .map((n) => {
      const s = sources[n - 1];
      return {
        n,
        chunkId: s.chunkId,
        documentId: s.documentId,
        documentName: s.documentName,
        pages: pageLabel(s.pageStart, s.pageEnd),
        section: s.section,
        snippet: s.content.length > 600 ? `${s.content.slice(0, 600).trimEnd()}…` : s.content,
        similarity: Math.round(s.similarity * 1000) / 1000,
      };
    });
}
