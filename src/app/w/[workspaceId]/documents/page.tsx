import type { Metadata } from "next";
import clsx from "clsx";
import { FileText, FileType, Hash } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { listDocuments, type DocumentRow } from "@/lib/data/documents";
import { getMyRole, getWorkspace } from "@/lib/data/workspaces";
import { DeleteDocumentButton } from "./delete-document-button";
import { UploadDropzone } from "./upload-dropzone";

export const metadata: Metadata = { title: "Documents" };
// Uploads run as Server Actions on this page: parsing + embedding can take a while.
export const maxDuration = 60;

const statusStyles: Record<DocumentRow["status"], string> = {
  ready: "bg-success/10 text-success",
  processing: "bg-lavender text-primary",
  failed: "bg-danger/10 text-danger",
};

function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage({ params }: PageProps<"/w/[workspaceId]/documents">) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const workspace = (await getWorkspace(workspaceId))!; // layout already 404s when missing
  const [documents, role] = await Promise.all([
    listDocuments(workspace.id),
    getMyRole(workspace.organization.id, user.id),
  ]);
  const isAdmin = role === "owner" || role === "admin";

  return (
    <>
      <PageHeader
        title="Documents"
        description={`Files in ${workspace.name} are searchable only inside this workspace.`}
      />
      <div className="mx-auto max-w-5xl space-y-8 p-6 sm:p-10">
        <UploadDropzone workspaceId={workspace.id} />

        {documents.length === 0 ? (
          <EmptyState icon={FileText} title="No documents yet" body="Upload a file above, then ask about it in Chat." />
        ) : (
          <section className="overflow-hidden rounded-3xl border border-line bg-white">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
              {documents.length} document{documents.length === 1 ? "" : "s"}
            </h2>
            <ul className="divide-y divide-line">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas text-primary">
                    <FileType className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{formatBytes(d.sizeBytes)}</span>
                      {d.pageCount !== null && <span>{d.pageCount} pages</span>}
                      {d.status === "ready" && (
                        <span className="inline-flex items-center gap-1">
                          <Hash className="size-3" aria-hidden />
                          {d.chunkCount} chunks
                        </span>
                      )}
                      <span>{new Date(d.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                    </p>
                    {d.status === "failed" && d.error && <p className="mt-1 text-xs text-danger">{d.error}</p>}
                  </div>
                  <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium capitalize", statusStyles[d.status])}>
                    {d.status}
                  </span>
                  {(isAdmin || d.uploadedBy === user.id) && (
                    <DeleteDocumentButton workspaceId={workspace.id} documentId={d.id} name={d.name} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
