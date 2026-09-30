// Runs one model-proposed tool call. "The model proposes; the app disposes."
// Never throws: every outcome (ok / rejected / error) goes back to the model as a result object,
// is logged to the workspace's tool log, and is summarised for the UI.
import type { FunctionCall } from "@google/genai";
import { TOOLS_BY_NAME } from "./registry";
import { ToolError, type ToolActivity, type ToolCallStatus, type ToolContext } from "./types";

const MAX_LOGGED_ARGS = 4000;

function loggableArgs(args: unknown): unknown {
  const json = JSON.stringify(args ?? {});
  return json.length <= MAX_LOGGED_ARGS ? (args ?? {}) : { truncated: true, preview: json.slice(0, MAX_LOGGED_ARGS) };
}

export async function executeToolCall(
  call: FunctionCall,
  ctx: ToolContext,
): Promise<{ response: Record<string, unknown>; activity: ToolActivity }> {
  const started = Date.now();
  const name = (call.name ?? "").slice(0, 100) || "(unnamed)";
  const tool = TOOLS_BY_NAME.get(name);

  let status: ToolCallStatus;
  let result: Record<string, unknown> | null = null;
  let error: string | null = null;
  let label: string;

  if (!tool) {
    status = "rejected";
    error = `Unknown tool "${name}". Available tools: ${[...TOOLS_BY_NAME.keys()].join(", ")}.`;
    label = `Blocked unknown tool "${name}"`;
  } else {
    const parsed = tool.schema.safeParse(call.args ?? {});
    const used = ctx.calls.get(name) ?? 0;
    if (!parsed.success) {
      status = "rejected";
      error = `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ")}`;
      label = `Rejected ${name}: invalid arguments`;
    } else if (tool.requiresIntent && !tool.requiresIntent.pattern.test(ctx.question)) {
      status = "rejected";
      error = `Not allowed: ${tool.requiresIntent.explain}. Only call ${name} when the user explicitly asks for it.`;
      label = `Blocked ${name}: not requested by you`;
    } else if (used >= tool.maxPerTurn) {
      status = "rejected";
      error = `Limit reached: ${name} can run at most ${tool.maxPerTurn} time(s) per message.`;
      label = `Blocked ${name}: limit reached`;
    } else {
      ctx.calls.set(name, used + 1);
      try {
        result = await tool.run(parsed.data, ctx);
        status = "ok";
        label = tool.label(parsed.data, result);
      } catch (e) {
        status = "error";
        error = e instanceof ToolError ? e.message : "The tool failed unexpectedly.";
        label = `${name} failed: ${error}`;
        if (!(e instanceof ToolError)) console.error("tool failed", { tool: name, message: (e as Error)?.message });
      }
    }
  }

  try {
    await ctx.services.logToolCall({
      toolName: name,
      args: loggableArgs(call.args),
      status,
      result,
      error,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    console.error("logging tool call failed", (e as Error)?.message);
  }

  return {
    response: status === "ok" ? { result } : { error },
    activity: { tool: name, status, label },
  };
}
