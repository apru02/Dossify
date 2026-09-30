import "server-only";
import type { Content, FunctionDeclaration, GenerateContentConfig, GenerateContentResponse } from "@google/genai";
import { CHAT_MODELS, gemini } from "./gemini";
import { isRetryable } from "./retry";

const CALL_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 45_000; // stay inside the 60s function limit

export type Generated = { response: GenerateContentResponse; model: string };
export type Streamed = { stream: AsyncGenerator<GenerateContentResponse>; model: string };

type GenerateOptions = {
  contents: Content[];
  systemInstruction: string;
  temperature?: number;
  tools?: FunctionDeclaration[];
};

function config(opts: GenerateOptions): GenerateContentConfig {
  return {
    systemInstruction: opts.systemInstruction,
    temperature: opts.temperature ?? 0.2,
    thinkingConfig: { thinkingLevel: "LOW" as never },
    ...(opts.tools?.length ? { tools: [{ functionDeclarations: opts.tools }] } : {}),
    httpOptions: { timeout: CALL_TIMEOUT_MS },
  };
}

/**
 * Model fallback. Per model: one retry on transient errors (429/5xx/timeout); a 404 (model
 * retired/unavailable) skips straight to the next model. Other errors (400, 403) are bugs or
 * config problems and are thrown immediately.
 */
async function withModelFallback<T>(attempt: (model: string) => Promise<T>): Promise<T> {
  const started = Date.now();
  let lastError: unknown;

  for (const model of CHAT_MODELS) {
    for (let n = 1; n <= 2; n++) {
      if (Date.now() - started > TOTAL_BUDGET_MS) throw lastError ?? new Error("Generation time budget exceeded");
      try {
        return await attempt(model);
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number }).status;
        console.warn("gemini generate failed", { model, attempt: n, status });
        if (status === 404) break; // try the next model
        if (!isRetryable(error)) throw error;
        if (n === 1) await new Promise((r) => setTimeout(r, 700 + Math.random() * 300));
      }
    }
  }
  throw lastError;
}

export function generateWithFallback(opts: GenerateOptions): Promise<Generated> {
  return withModelFallback(async (model) => {
    const response = await gemini().models.generateContent({ model, contents: opts.contents, config: config(opts) });
    return { response, model: response.modelVersion ?? model };
  });
}

/**
 * Streaming variant. Fallback covers opening the stream AND its first chunk (where overload
 * errors surface); once text has started flowing, a failure is final for this attempt.
 */
export function streamWithFallback(opts: GenerateOptions): Promise<Streamed> {
  return withModelFallback(async (model) => {
    const source = await gemini().models.generateContentStream({ model, contents: opts.contents, config: config(opts) });
    const first = await source.next();
    async function* stream() {
      if (!first.done) yield first.value;
      yield* source;
    }
    return { stream: stream(), model: (!first.done && first.value.modelVersion) || model };
  });
}
