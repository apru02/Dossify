import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { getSession, listMessages } from "@/lib/data/chat";
import { countReadyDocuments } from "@/lib/data/documents";
import { getWorkspace } from "@/lib/data/workspaces";

export const maxDuration = 60;

export async function generateMetadata({ params }: PageProps<"/w/[workspaceId]/c/[sessionId]">): Promise<Metadata> {
  const { workspaceId, sessionId } = await params;
  const session = await getSession(workspaceId, sessionId);
  return { title: session?.title ?? "Chat" };
}

export default async function ChatSessionPage({ params }: PageProps<"/w/[workspaceId]/c/[sessionId]">) {
  const { workspaceId, sessionId } = await params;
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing
  // RLS: only the user's own session, and only in this workspace.
  const session = await getSession(workspace.id, sessionId);
  if (!session) notFound();

  const [messages, readyDocuments] = await Promise.all([
    listMessages(workspace.id, session.id),
    countReadyDocuments(workspace.id),
  ]);

  return (
    <ChatPanel
      key={session.id}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      session={session}
      messages={messages}
      readyDocuments={readyDocuments}
    />
  );
}
