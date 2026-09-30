import type { Metadata } from "next";
import { FileText, Upload } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <>
      <PageHeader
        title="Documents"
        description="Files uploaded here are searchable only inside this workspace."
        actions={
          <Button disabled>
            <Upload className="size-4" aria-hidden /> Upload
          </Button>
        }
      />
      <div className="p-6 sm:p-10">
        <EmptyState icon={FileText} title="No documents yet" body="Upload PDFs, Markdown or text files to start asking questions. Uploads arrive in the next build step." />
      </div>
    </>
  );
}
