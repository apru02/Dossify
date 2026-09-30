import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Tool Logs" };

export default function ToolLogsPage() {
  return (
    <>
      <PageHeader title="Tool Logs" description="Every tool the assistant calls in this workspace: arguments, result and status." />
      <div className="p-6 sm:p-10">
        <EmptyState icon={ScrollText} title="No tool calls yet" body="When the assistant saves a task or sends a summary, it will be recorded here." />
      </div>
    </>
  );
}
