import "server-only";
import type { Content, Part } from "@google/genai";
import { generateWithFallback } from "@/lib/ai/generate";
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
}): Promise<TurnResult> {
  const contents: Content[] = [...opts.history, { role: "user", parts: [{ text: opts.userText }] }];
  const activities: ToolActivity[] = [];
  let promptTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;

  for (let round = 0; ; round++) {
    // After the last allowed round, ask for a final answer with no tools offered.
    const offerTools = round < MAX_TOOL_ROUNDS;
    const { response, model: used } = await generateWithFallback({
      systemInstruction: opts.systemInstruction,
      contents,
      tools: offerTools ? TOOL_DECLARATIONS : undefined,
    });
    model = used;
    promptTokens += response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

    const calls = offerTools ? (response.functionCalls ?? []) : [];
    if (calls.length === 0) {
      return { text: response.text?.trim() ?? "", model, promptTokens, outputTokens, activities };
    }

    // Keep the model's turn exactly as returned: it can carry thought signatures that Gemini
    // needs to see again on the next request.
    const modelTurn = response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    const parts: Part[] = [];
    for (const call of calls) {
      const { response: result, activity } = await executeToolCall(call, opts.tool);
      activities.push(activity);
      parts.push({ functionResponse: { id: call.id, name: call.name, response: result } });
    }
    contents.push({ role: "user", parts });
  }
}
