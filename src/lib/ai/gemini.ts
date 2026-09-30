import "server-only";
import { GoogleGenAI } from "@google/genai";

export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768; // must match vector(768) in the migration

// Tried in order. Measured on the free tier (Sept 2026): flash-lite answered grounded prompts in
// ~1s and passed our refusal/injection checks, while gemini-flash-latest returned 503 "high
// demand" on most calls. Pinned older models (e.g. gemini-2.5-flash) now 404 for new keys,
// so the chain prefers "-latest" aliases and falls through on 404/429/5xx.
export const CHAT_MODELS = (
  process.env.GEMINI_CHAT_MODELS ?? "gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-flash-latest"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}
