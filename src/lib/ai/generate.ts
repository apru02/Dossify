import "server-only";
import type { Content, GenerateContentResponse } from "@google/genai";
import { CHAT_MODELS, gemini } from "./gemini";
import { isRetryable } from "./retry";

const CALL_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 45_000; // stay inside the 60s function limit

export type Generated = { response: GenerateContentResponse; model: string };

/**
 * Generate with model fallback. Per model: one retry on transient errors (429/5xx/timeout);
 * a 404 (model retired/unavailable) skips straight to the next model. Other errors (400, 403)
 * are bugs or config problems and are thrown immediately.
 */
export async function generateWithFallback(opts: {
  contents: Content[];
  systemInstruction: string;
  temperature?: number;
}): Promise<Generated> {
  const started = Date.now();
  let lastError: unknown;

  for (const model of CHAT_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (Date.now() - started > TOTAL_BUDGET_MS) throw lastError ?? new Error("Generation time budget exceeded");
      try {
        const response = await gemini().models.generateContent({
          model,
          contents: opts.contents,
          config: {
            systemInstruction: opts.systemInstruction,
            temperature: opts.temperature ?? 0.2,
            thinkingConfig: { thinkingLevel: "LOW" as never },
            httpOptions: { timeout: CALL_TIMEOUT_MS },
          },
        });
        return { response, model: response.modelVersion ?? model };
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number }).status;
        console.warn("gemini generate failed", { model, attempt, status });
        if (status === 404) break; // try the next model
        if (!isRetryable(error)) throw error;
        if (attempt === 1) await new Promise((r) => setTimeout(r, 700 + Math.random() * 300));
      }
    }
  }
  throw lastError;
}
