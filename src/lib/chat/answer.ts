import "server-only";
import type { Content } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCitations, isNoAnswer, removeInvalidCitations } from "@/lib/rag/citations";
import { NO_ANSWER, historyText, systemPrompt, userTurn } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { MIN_BEST_SIMILARITY, selectContext } from "@/lib/rag/select";
import { TOOLS_BY_NAME, mightUseTools } from "@/lib/tools/registry";
import { supabaseToolServices } from "@/lib/tools/services";
import { runTurn } from "./run-turn";

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
    userName: string; // shown in Slack as "Shared by …"
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

    // Honest refusal without spending an LLM call: nothing relevant was found and the message
    // doesn't look like a request a tool could handle.
    if (context.length === 0 && !mightUseTools(args.question)) {
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

    // On a retry, side effects that already succeeded for this message must not run again
    // (no duplicate tasks or Slack posts): mark those tools as used up for this turn.
    const calls = new Map<string, number>();
    const { data: done } = await supabase
      .from("tool_calls")
      .select("tool_name")
      .eq("message_id", args.assistantId)
      .eq("status", "ok")
      .returns<{ tool_name: string }[]>();
    for (const { tool_name } of done ?? []) {
      const tool = TOOLS_BY_NAME.get(tool_name);
      if (tool?.requiresIntent) calls.set(tool_name, tool.maxPerTurn);
    }

    const turn = await runTurn({
      systemInstruction: systemPrompt(args.workspaceName),
      history,
      userText: userTurn(args.question, context),
      tool: {
        workspaceName: args.workspaceName,
        userName: args.userName,
        question: args.question,
        calls,
        services: supabaseToolServices(supabase, {
          workspaceId: args.workspaceId,
          sessionId: args.sessionId,
          messageId: args.assistantId,
        }),
      },
    });

    const toolsSucceeded = turn.activities.some((a) => a.status === "ok");
    let answer = turn.text;
    if (!answer) {
      if (!turn.activities.length) throw new Error("Empty response from the model");
      answer = turn.activities.map((a) => `- ${a.label}`).join("\n");
    }
    if (context.length === 0) {
      // Nothing from the documents: the only acceptable replies are tool confirmations or a refusal.
      if (!toolsSucceeded && !isNoAnswer(answer)) answer = NO_ANSWER;
    } else {
      answer = isNoAnswer(answer) && !toolsSucceeded ? NO_ANSWER : removeInvalidCitations(answer, context.length);
    }

    await finish({
      status: "complete",
      content: answer,
      citations: context.length ? buildCitations(answer, context) : [],
      retrieval,
      model: turn.model,
      prompt_tokens: turn.promptTokens || null,
      output_tokens: turn.outputTokens || null,
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
