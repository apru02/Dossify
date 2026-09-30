import "server-only";
import type { Content, FunctionCall, Part } from "@google/genai";
import { generateWithFallback, streamWithFallback } from "@/lib/ai/generate";
import { executeToolCall } from "@/lib/tools/execute";
import { TOOL_DECLARATIONS } from "@/lib/tools/registry";
import type { ToolActivity, ToolContext } from "@/lib/tools/types";

const MAX_TOOL_ROUNDS = 4; // model → tools → model … at most this many tool rounds per message

export type TurnResult = {
  text: string;
  model: string | null;
  promptTokens: number;
  outputTokens: number;
  activities: ToolActivity[];
};

// Optional live events. With `onText`, the model's reply is streamed token by token.
export type TurnEvents = {
  onText?: (delta: string) => void;
  onToolStart?: (toolName: string) => void;
  onTool?: (activity: ToolActivity) => void;
};

type Step = { text: string; calls: FunctionCall[]; modelTurn: Content | null; model: string; prompt: number; output: number };

async function modelStep(contents: Content[], systemInstruction: string, offerTools: boolean, onText?: (d: string) => void): Promise<Step> {
  const tools = offerTools ? TOOL_DECLARATIONS : undefined;

  if (!onText) {
    const { response, model } = await generateWithFallback({ systemInstruction, contents, tools });
    return {
      text: response.text?.trim() ?? "",
      calls: offerTools ? (response.functionCalls ?? []) : [],
      // Keep the model's turn exactly as returned: it can carry thought signatures that Gemini
      // needs to see again on the next request.
      modelTurn: response.candidates?.[0]?.content ?? null,
      model,
      prompt: response.usageMetadata?.promptTokenCount ?? 0,
      output: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  const { stream, model } = await streamWithFallback({ systemInstruction, contents, tools });
  const parts: Part[] = [];
  let text = "";
  let prompt = 0;
  let output = 0;
  for await (const chunk of stream) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      parts.push(part); // every part, including thought signatures, goes back into history
      if (part.text && !part.thought) {
        text += part.text;
        onText(part.text);
      }
    }
    prompt = chunk.usageMetadata?.promptTokenCount ?? prompt;
    output = chunk.usageMetadata?.candidatesTokenCount ?? output;
  }
  const calls = offerTools ? parts.flatMap((p) => (p.functionCall ? [p.functionCall] : [])) : [];
  return { text: text.trim(), calls, modelTurn: parts.length ? { role: "model", parts } : null, model, prompt, output };
}

/**
 * One assistant turn with multi-step tool use: the model may call tools, see their results, and
 * call more before answering. Every call goes through executeToolCall (validate → gate → run →
 * log). Errors from the model API propagate to the caller, which records a retryable failure.
 */
export async function runTurn(opts: {
  systemInstruction: string;
  history: Content[];
  userText: string;
  tool: ToolContext;
  events?: TurnEvents;
}): Promise<TurnResult> {
  const contents: Content[] = [...opts.history, { role: "user", parts: [{ text: opts.userText }] }];
  const activities: ToolActivity[] = [];
  let promptTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;

  for (let round = 0; ; round++) {
    // After the last allowed round, ask for a final answer with no tools offered.
    const step = await modelStep(contents, opts.systemInstruction, round < MAX_TOOL_ROUNDS, opts.events?.onText);
    model = step.model;
    promptTokens += step.prompt;
    outputTokens += step.output;

    if (step.calls.length === 0) {
      return { text: step.text, model, promptTokens, outputTokens, activities };
    }

    if (step.modelTurn) contents.push(step.modelTurn);
    const parts: Part[] = [];
    for (const call of step.calls) {
      opts.events?.onToolStart?.(call.name ?? "tool");
      const { response: result, activity } = await executeToolCall(call, opts.tool);
      activities.push(activity);
      opts.events?.onTool?.(activity);
      parts.push({ functionResponse: { id: call.id, name: call.name, response: result } });
    }
    contents.push({ role: "user", parts });
  }
}
