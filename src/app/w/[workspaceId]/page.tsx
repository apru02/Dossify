import { ChatPanel } from "@/components/chat/chat-panel";
import { listMessages } from "@/lib/data/chat";
import { countReadyDocuments } from "@/lib/data/documents";
import { getWorkspace } from "@/lib/data/workspaces";

// Answers are generated inside the askQuestion Server Action on this page.
export const maxDuration = 60;

export default async function ChatPage({ params }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing
  const [messages, readyDocuments] = await Promise.all([listMessages(workspace.id), countReadyDocuments(workspace.id)]);

  return (
    <ChatPanel
      key={workspace.id}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      messages={messages}
      readyDocuments={readyDocuments}
    />
  );
}
