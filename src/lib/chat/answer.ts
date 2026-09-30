import "server-only";
import type { Content } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/ai/generate";
import { buildCitations, isNoAnswer, removeInvalidCitations } from "@/lib/rag/citations";
import { NO_ANSWER, historyText, systemPrompt, userTurn } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { MIN_BEST_SIMILARITY, selectContext } from "@/lib/rag/select";

const HISTORY_MESSAGES = 6; // last 3 exchanges, for follow-up questions

type HistoryRow = { role: "user" | "assistant"; content: string };

/**
 * Fill in a pending assistant message. Never throws: on failure the row is marked `error`
 * (the user's question is already saved, so they can retry).
 */
export async function answerQuestion(
  supabase: SupabaseClient,
  args: {
    workspaceId: string;
    workspaceName: string;
    sessionId: string; // conversation history comes from this session only; documents are workspace-wide
    assistantId: string;
    question: string;
    questionCreatedAt: string; // history = messages before the question (also correct on retry)
  },
): Promise<void> {
  const started = Date.now();
  const finish = async (patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from("chat_messages")
      .update({ ...patch, latency_ms: Date.now() - started })
      .eq("id", args.assistantId);
    if (error) console.error("saving answer failed", error.code, error.message);
  };

  try {
    const retrieved = await retrieveChunks(supabase, args.workspaceId, args.question);
    const { context, best } = selectContext(retrieved);
    const retrieval = {
      workspaceId: args.workspaceId,
      threshold: MIN_BEST_SIMILARITY,
      best: Math.round(best * 1000) / 1000,
      gated: context.length === 0,
      chunks: retrieved.map((c) => ({
        chunkId: c.chunkId,
        documentName: c.documentName,
        similarity: Math.round(c.similarity * 1000) / 1000,
        used: context.includes(c),
      })),
    };

    // Honest refusal without spending an LLM call when nothing relevant was found.
    if (context.length === 0) {
      await finish({ status: "complete", content: NO_ANSWER, citations: [], retrieval, error: null });
      return;
    }

    const { data: prior } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", args.sessionId)
      .eq("status", "complete")
      .lt("created_at", args.questionCreatedAt)
      .order("created_at", { ascending: false })
      .limit(HISTORY_MESSAGES)
      .returns<HistoryRow[]>();

    // Gemini expects user/model turns to alternate starting with user; failed answers can leave
    // two user turns in a row, so merge those.
    const history: Content[] = [];
    for (const m of (prior ?? []).reverse()) {
      const role = m.role === "assistant" ? "model" : "user";
      const text = m.role === "assistant" ? historyText(m.content) : m.content;
      const last = history.at(-1);
      if (!last && role === "model") continue;
      if (last?.role === role) last.parts!.push({ text });
      else history.push({ role, parts: [{ text }] });
    }
    if (history.at(-1)?.role === "user") history.pop(); // the new question must follow a model turn

    const { response, model } = await generateWithFallback({
      systemInstruction: systemPrompt(args.workspaceName),
      contents: [...history, { role: "user", parts: [{ text: userTurn(args.question, context) }] }],
    });

    const raw = response.text?.trim();
    if (!raw) throw new Error(`Empty response (finishReason: ${response.candidates?.[0]?.finishReason})`);
    const answer = isNoAnswer(raw) ? NO_ANSWER : removeInvalidCitations(raw, context.length);

    await finish({
      status: "complete",
      content: answer,
      citations: buildCitations(answer, context),
      retrieval,
      model,
      prompt_tokens: response.usageMetadata?.promptTokenCount ?? null,
      output_tokens: response.usageMetadata?.candidatesTokenCount ?? null,
      error: null,
    });
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    console.error("answerQuestion failed", { status: e.status, code: e.code, message: e.message?.slice(0, 300) });
    const busy = e.status === 429 || e.status === 503;
    await finish({
      status: "error",
      error: busy
        ? "The AI service is busy right now. Your question is saved. Try again in a moment."
        : "Something went wrong while answering. Your question is saved. Try again.",
    });
  }
}
