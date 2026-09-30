// The tools the model may call. Each has ONE strict Zod schema: it generates the JSON schema the
// model sees and validates what the model sends back. Unknown keys are rejected, and no tool takes
// a workspace/user id: scope comes from the server-side ToolContext.
import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import type { ToolContext } from "./types";

type ToolDef<S extends z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  maxPerTurn: number;
  // Side-effecting tools only run when the user's own message asks for that kind of action.
  // Document text or earlier turns can't authorise them (prompt-injection defence).
  requiresIntent?: { pattern: RegExp; explain: string };
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<Record<string, unknown>>;
  label: (args: z.infer<S>, result: Record<string, unknown>) => string;
};

const defineTool = <S extends z.ZodType>(def: ToolDef<S>) => def;

const saveTask = defineTool({
  name: "save_task",
  description:
    "Save a to-do task in the current workspace. Use only when the user asks to save, add, track or be reminded of something.",
  schema: z.strictObject({
    title: z.string().trim().min(3).max(200).describe("Short, actionable task title"),
    due_date: z.iso.date().optional().describe("Due date as YYYY-MM-DD, if the user gave one"),
    notes: z.string().trim().max(1000).optional().describe("Optional extra detail"),
  }),
  maxPerTurn: 5,
  requiresIntent: {
    pattern: /\b(tasks?|to-?dos?|remind(er)?s?|remember|follow[ -]?up|save|add|track|note\b|don'?t forget|schedule)/i,
    explain: "The user's message doesn't ask to save a task",
  },
  run: async (args, ctx) => {
    const task = await ctx.services.createTask({ title: args.title, dueDate: args.due_date ?? null, notes: args.notes ?? null });
    return { saved: true, task: { title: task.title, due_date: task.dueDate, status: task.status } };
  },
  label: (args) => `Saved task "${args.title}"${args.due_date ? ` (due ${args.due_date})` : ""}`,
});

const listTasks = defineTool({
  name: "list_tasks",
  description: "List tasks saved in the current workspace. Read-only.",
  schema: z.strictObject({
    status: z.enum(["open", "done", "all"]).optional().describe("Which tasks to list (default: open)"),
    limit: z.number().int().min(1).max(20).optional().describe("Maximum number of tasks (default 10)"),
  }),
  maxPerTurn: 3,
  run: async (args, ctx) => {
    const tasks = await ctx.services.listTasks({ status: args.status ?? "open", limit: args.limit ?? 10 });
    return {
      count: tasks.length,
      tasks: tasks.map((t) => ({ title: t.title, status: t.status, due_date: t.dueDate, notes: t.notes })),
    };
  },
  label: (args, result) => `Listed ${result.count} ${args.status === "all" ? "" : `${args.status ?? "open"} `}task${result.count === 1 ? "" : "s"}`,
});

const sendSummary = defineTool({
  name: "send_summary",
  description:
    "Post a short summary to the team's Slack channel. Use only when the user explicitly asks to send, share or post something to Slack or the team. Write the summary yourself from the conversation and sources.",
  schema: z.strictObject({
    title: z.string().trim().min(3).max(120).describe("Headline for the Slack message"),
    summary: z.string().trim().min(10).max(2500).describe("The summary to post (Markdown allowed)"),
  }),
  maxPerTurn: 1,
  requiresIntent: {
    pattern: /\b(slack|send|share|post|notify|announce|channel|tell (the )?team|message (the )?team)\b/i,
    explain: "The user's message doesn't ask to send anything to Slack",
  },
  run: async (args, ctx) => {
    await ctx.services.postToSlack({ title: args.title, text: args.summary, sharedBy: ctx.userName, workspaceName: ctx.workspaceName });
    return { delivered: true, channel: "Slack" };
  },
  label: (args) => `Sent "${args.title}" to Slack`,
});

// Loosely typed on purpose: the executor validates with each tool's own schema before calling run.
export const TOOLS = [saveTask, listTasks, sendSummary] as unknown as ToolDef<z.ZodType>[];
export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Gemini accepts JSON Schema via parametersJsonSchema; drop keys it doesn't need.
export const TOOL_DECLARATIONS: FunctionDeclaration[] = TOOLS.map((t) => {
  const parameters = z.toJSONSchema(t.schema) as Record<string, unknown>;
  delete parameters.$schema;
  return { name: t.name, description: t.description, parametersJsonSchema: parameters };
});

// Cheap pre-check: could this message need a tool? If not, and no document matched, we can answer
// "I don't know" without calling the LLM at all.
export function mightUseTools(question: string): boolean {
  return (
    /\b(tasks?|to-?dos?)\b/i.test(question) ||
    TOOLS.some((t) => t.requiresIntent?.pattern.test(question))
  );
}
