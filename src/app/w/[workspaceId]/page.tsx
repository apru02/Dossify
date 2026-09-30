import { ChatPanel } from "@/components/chat/chat-panel";
import { countReadyDocuments } from "@/lib/data/documents";
import { getWorkspace } from "@/lib/data/workspaces";

// "New chat": the session is created by askQuestion when the first question is sent.
// Answers are generated inside that Server Action, hence the longer limit.
export const maxDuration = 60;

export default async function NewChatPage({ params }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing
  const readyDocuments = await countReadyDocuments(workspace.id);

  return (
    <ChatPanel
      key={`${workspace.id}:new`}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      session={null}
      messages={[]}
      readyDocuments={readyDocuments}
    />
  );
}
