// Wire format of POST /api/chat: one JSON object per line (NDJSON). Shared by server and client.
import type { FinalAnswer } from "./answer";
import type { ToolActivity } from "@/lib/tools/types";

export type ChatStreamEvent =
  | { type: "start"; sessionId: string; newSession: boolean; assistantId: string }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool"; activity: ToolActivity }
  | { type: "done"; answer: FinalAnswer };

// Incrementally parse an NDJSON byte stream into events.
export async function* readChatStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as ChatStreamEvent;
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as ChatStreamEvent;
}
