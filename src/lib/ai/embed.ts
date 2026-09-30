import "server-only";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, gemini } from "./gemini";
import { withRetry } from "./retry";

const BATCH_SIZE = 50; // Gemini accepts up to 100 texts per request; smaller batches retry cheaper.

// taskType matters: documents and queries are embedded asymmetrically so a short question
// lands near the passage that answers it.
async function embed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  // Patient retries: free-tier embedding limits are per minute.
  const res = await withRetry(
    () =>
      gemini().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texts,
        config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
      }),
    { attempts: 4, baseMs: 1500 },
  );
  const vectors = res.embeddings?.map((e) => e.values ?? []) ?? [];
  if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error(`Embedding response had unexpected shape (${vectors.length} vectors for ${texts.length} texts)`);
  }
  return vectors;
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await embed(texts.slice(i, i + BATCH_SIZE), "RETRIEVAL_DOCUMENT")));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  return (await embed([text], "RETRIEVAL_QUERY"))[0];
}

// pgvector's text input format.
export const toPgVector = (v: number[]) => `[${v.join(",")}]`;
