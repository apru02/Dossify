// Types shared by the tool registry, executor and service implementations.

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  status: "open" | "done";
  createdAt: string;
};

export type ToolCallStatus = "ok" | "rejected" | "error";

export type ToolLogEntry = {
  toolName: string;
  args: unknown;
  status: ToolCallStatus;
  result: unknown;
  error: string | null;
  latencyMs: number;
};

// Everything a tool may touch. Implementations are always scoped to ONE workspace and act as the
// signed-in user (RLS applies). Tools never receive ids from the model.
export interface ToolServices {
  createTask(input: { title: string; dueDate: string | null; notes: string | null }): Promise<TaskRow>;
  listTasks(filter: { status: "open" | "done" | "all"; limit: number }): Promise<TaskRow[]>;
  postToSlack(message: { title: string; text: string; sharedBy: string; workspaceName: string }): Promise<void>;
  logToolCall(entry: ToolLogEntry): Promise<void>;
}

export type ToolContext = {
  workspaceName: string;
  userName: string;
  question: string; // the user's latest message: the only source of intent for side effects
  services: ToolServices;
  calls: Map<string, number>; // per-turn call counts, for limits
};

// What the chat UI shows under an answer.
export type ToolActivity = { tool: string; status: ToolCallStatus; label: string };

// An error whose message is safe to show the user and the model.
export class ToolError extends Error {}
