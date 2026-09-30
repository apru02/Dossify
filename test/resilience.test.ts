// "Doesn't lose work or fall over": model outages, fallback, and grounding enforcement when the
// model misbehaves. The Gemini client, retrieval and the tool loop are mocked; the logic under test
// (generateWithFallback, answerQuestion) is the real code.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "@/lib/rag/prompt";

const generateContent = vi.fn();
vi.mock("@/lib/ai/gemini", () => ({
  CHAT_MODELS: ["primary-model", "fallback-model"],
  gemini: () => ({ models: { generateContent } }),
}));

const retrieveChunks = vi.fn<() => Promise<SourceChunk[]>>();
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks: () => retrieveChunks() }));

const runTurn = vi.fn();
vi.mock("@/lib/chat/run-turn", () => ({ runTurn: (...args: unknown[]) => runTurn(...args) }));

const { generateWithFallback } = await import("@/lib/ai/generate");
const { answerQuestion } = await import("@/lib/chat/answer");
const { NO_ANSWER } = await import("@/lib/rag/prompt");

const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const ok = (text: string, modelVersion: string) => ({ text, modelVersion, candidates: [], usageMetadata: {} });

describe("generateWithFallback", () => {
  // Block body on purpose: a function returned from beforeEach is run as a teardown hook, and
  // mockReset() returns the mock itself, so Vitest would call it after every test.
  beforeEach(() => {
    generateContent.mockReset();
  });

  it("retries a busy model, then falls back to the next one", async () => {
    generateContent
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce(ok("hi", "fallback-model-v2"));
    const { model } = await generateWithFallback({ contents: [], systemInstruction: "s" });
    expect(model).toBe("fallback-model-v2");
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["primary-model", "primary-model", "fallback-model"]);
  });

  it("skips a retired model (404) immediately", async () => {
    generateContent.mockRejectedValueOnce(apiError(404)).mockResolvedValueOnce(ok("hi", "fallback-model"));
    await generateWithFallback({ contents: [], systemInstruction: "s" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry or fall back on a bad request (a bug, not an outage)", async () => {
    generateContent.mockImplementation(() => {
      throw apiError(400);
    });
    await expect(generateWithFallback({ contents: [], systemInstruction: "s" })).rejects.toThrow("HTTP 400");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("gives up with the last error when every model is down", async () => {
    generateContent.mockImplementation(() => {
      throw apiError(503);
    });
    await expect(generateWithFallback({ contents: [], systemInstruction: "s" })).rejects.toThrow("HTTP 503");
    expect(generateContent).toHaveBeenCalledTimes(4); // 2 models × 2 attempts
  });
});

// Minimal stand-in for the Supabase client: every query resolves empty; updates are recorded.
function fakeSupabase() {
  const updates: Record<string, unknown>[] = [];
  const chain: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        if (prop === "update")
          return (patch: Record<string, unknown>) => {
            updates.push(patch);
            return chain;
          };
        return () => chain;
      },
    },
  );
  return { client: { from: () => chain, rpc: () => chain } as never, updates, last: () => updates.at(-1)! };
}

const leave: SourceChunk = {
  chunkId: 1, documentId: "d", documentName: "handbook.pdf", chunkIndex: 0, pageStart: 2, pageEnd: 2, section: null,
  content: "Employees get 24 days of leave.", similarity: 0.74,
};
const args = (question: string) => ({
  workspaceId: "ws", workspaceName: "HR", userName: "Alice", sessionId: "s", assistantId: "a", question,
  questionCreatedAt: new Date().toISOString(),
});
const turn = (text: string, activities: { tool: string; status: string; label: string }[] = []) => ({
  text, model: "m", promptTokens: 10, outputTokens: 5, activities,
});

describe("answerQuestion", () => {
  beforeEach(() => {
    retrieveChunks.mockReset();
    runTurn.mockReset();
  });

  it("records a retryable error (and never throws) when the model is down", async () => {
    const db = fakeSupabase();
    retrieveChunks.mockResolvedValue([leave]);
    runTurn.mockRejectedValue(apiError(503));
    const final = await answerQuestion(db.client, args("How much leave?")); // resolves, never throws
    expect(db.last()).toMatchObject({ status: "error", error: expect.stringMatching(/busy.*saved/i) });
    expect(final).toMatchObject({ status: "error", error: expect.stringMatching(/busy/i) }); // what the stream's "done" carries
  });

  it("records an error when retrieval/embeddings fail", async () => {
    const db = fakeSupabase();
    retrieveChunks.mockRejectedValue(new Error("embedding service down"));
    await answerQuestion(db.client, args("How much leave?"));
    expect(db.last()).toMatchObject({ status: "error" });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("refuses off-topic questions without calling the model", async () => {
    const db = fakeSupabase();
    retrieveChunks.mockResolvedValue([]);
    await answerQuestion(db.client, args("Who won the World Cup?"));
    expect(runTurn).not.toHaveBeenCalled();
    expect(db.last()).toMatchObject({ status: "complete", content: NO_ANSWER, citations: [] });
  });

  it("overrides an ungrounded answer when no document matched and no tool ran", async () => {
    const db = fakeSupabase();
    retrieveChunks.mockResolvedValue([]);
    runTurn.mockResolvedValue(turn("Your tasks are probably fine. Paris is the capital of France."));
    await answerQuestion(db.client, args("What are my tasks?"));
    expect(db.last()).toMatchObject({ status: "complete", content: NO_ANSWER });
  });

  it("keeps a tool confirmation even without matching documents", async () => {
    const db = fakeSupabase();
    retrieveChunks.mockResolvedValue([]);
    runTurn.mockResolvedValue(turn("You have 2 open tasks: …", [{ tool: "list_tasks", status: "ok", label: "Listed 2 open tasks" }]));
    await answerQuestion(db.client, args("What are my tasks?"));
    expect(db.last()).toMatchObject({ status: "complete", content: "You have 2 open tasks: …" });
  });

  it("strips citations to sources that don't exist and cites the real one", async () => {
    const db = fakeSupabase();
    retrieveChunks.mockResolvedValue([leave]);
    runTurn.mockResolvedValue(turn("You get 24 days [1]. Also 30 days for contractors [7]."));
    await answerQuestion(db.client, args("How much leave?"));
    const saved = db.last();
    expect(saved.content).toBe("You get 24 days [1]. Also 30 days for contractors .");
    expect(saved.citations).toEqual([expect.objectContaining({ n: 1, documentName: "handbook.pdf", pages: "p. 2" })]);
  });

  it("treats an empty model reply as a failure, not a blank answer", async () => {
    const db = fakeSupabase();
    retrieveChunks.mockResolvedValue([leave]);
    runTurn.mockResolvedValue(turn(""));
    await answerQuestion(db.client, args("How much leave?"));
    expect(db.last()).toMatchObject({ status: "error" });
  });
});
