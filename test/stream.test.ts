import { describe, expect, it } from "vitest";
import { readChatStream, type ChatStreamEvent } from "@/lib/chat/stream-events";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function collect(chunks: string[]) {
  const out: ChatStreamEvent[] = [];
  for await (const e of readChatStream(streamOf(chunks))) out.push(e);
  return out;
}

describe("readChatStream (NDJSON)", () => {
  it("parses events split across network chunks at arbitrary points", async () => {
    const lines = [
      { type: "status", text: "Searching…" },
      { type: "delta", text: "You get 24 " },
      { type: "delta", text: "days [1]." },
    ].map((e) => JSON.stringify(e) + "\n");
    const whole = lines.join("");
    const pieces = [whole.slice(0, 7), whole.slice(7, 40), whole.slice(40, 41), whole.slice(41)];
    const events = await collect(pieces);
    expect(events.map((e) => e.type)).toEqual(["status", "delta", "delta"]);
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("You get 24 days [1].");
  });

  it("handles multi-byte characters split between chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "delta", text: "café – 📄" }) + "\n");
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 20));
        c.enqueue(bytes.slice(20));
        c.close();
      },
    });
    const out: ChatStreamEvent[] = [];
    for await (const e of readChatStream(s)) out.push(e);
    expect(out).toEqual([{ type: "delta", text: "café – 📄" }]);
  });

  it("accepts a final line without a trailing newline", async () => {
    expect(await collect(['{"type":"status","text":"a"}\n{"type":"status","text":"b"}'])).toHaveLength(2);
  });
});
