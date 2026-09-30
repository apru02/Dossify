import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listWorkspaces } from "@/lib/data/workspaces";

// Entry point after login: go to the last workspace the user opened, else their first one.
export default async function DashboardPage() {
  await requireUser();
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) redirect("/onboarding");

  const last = (await cookies()).get("dossify_ws")?.value;
  const target = workspaces.find((w) => w.id === last) ?? workspaces[0];
  redirect(`/w/${target.id}`);
}
