import type { Metadata } from "next";
import { CheckSquare } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <>
      <PageHeader title="Tasks" description="Tasks the assistant saves for this workspace." />
      <div className="p-6 sm:p-10">
        <EmptyState icon={CheckSquare} title="No tasks yet" body="Ask the assistant to save a task, e.g. “Remind me to renew the contract by Friday.”" />
      </div>
    </>
  );
}
