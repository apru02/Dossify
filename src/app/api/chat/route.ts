import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { displayName, getCurrentUser } from "@/lib/auth";
import { answerQuestion } from "@/lib/chat/answer";
import { startQuestion } from "@/lib/chat/start";
import type { ChatStreamEvent } from "@/lib/chat/stream-events";
import { getWorkspace } from "@/lib/data/workspaces";
import { createClient } from "@/lib/supabase/server";

// Retrieval + generation + tools run inside this request.
export const maxDuration = 60;

const body = z.object({
  workspaceId: z.uuid(),
  sessionId: z.uuid().nullable(),
  question: z.string().trim().min(1, "Type a question").max(2000, "Keep questions under 2,000 characters"),
});

const json = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Ask a question and stream the answer as newline-delimited JSON events
 * (see ChatStreamEvent). The question is saved before streaming starts, and the answer is saved
 * by the server even if the client disconnects midway.
 */
export async function POST(request: NextRequest) {
  // Same-origin only (defence in depth on top of SameSite auth cookies).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return json("Forbidden", 403);

  const user = await getCurrentUser();
  if (!user) return json("Please sign in again.", 401);

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  const { question } = parsed.data;

  // RLS-scoped: ids from the browser are only lookup keys.
  const workspace = await getWorkspace(parsed.data.workspaceId);
  if (!workspace) return json("Workspace not found.", 404);

  const supabase = await createClient();
  const started = await startQuestion(supabase, workspace.id, parsed.data.sessionId, question);
  if (!started.ok) return json(started.error, started.status);
  const q = started.value;

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let clientGone = false;
  const send = (event: ChatStreamEvent) => {
    if (clientGone) return;
    writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => {
      clientGone = true; // keep working; the answer is still saved
    });
  };

  // Not awaited: the response streams while this runs. answerQuestion never throws.
  void (async () => {
    send({ type: "start", sessionId: q.sessionId, newSession: q.newSession, assistantId: q.assistantId });
    const final = await answerQuestion(
      supabase,
      {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userName: displayName(user),
        sessionId: q.sessionId,
        assistantId: q.assistantId,
        question,
        questionCreatedAt: q.questionCreatedAt,
      },
      {
        onStatus: (text) => send({ type: "status", text }),
        onText: (text) => send({ type: "delta", text }),
        onTool: (activity) => send({ type: "tool", activity }),
      },
    );
    send({ type: "done", answer: final });
    await writer.close().catch(() => undefined);
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
