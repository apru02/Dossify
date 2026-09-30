import Link from "next/link";
import { FileText, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { getCurrentUser } from "@/lib/auth";

const features = [
  { icon: FileText, title: "Ask your documents", body: "Upload PDFs and notes, then ask questions in plain language." },
  { icon: Sparkles, title: "Cited answers", body: "Every answer points back to the source. No source, no made-up answer." },
  { icon: Zap, title: "Take action", body: "Save tasks and share summaries with your team, right from the chat." },
  { icon: ShieldCheck, title: "Private workspaces", body: "Each workspace's knowledge stays in that workspace. Always." },
];

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo size={32} />
        <nav className="flex items-center gap-2">
          {user ? (
            <Link href="/dashboard" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
              Open Dossify
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-xl px-4 py-2 text-sm font-semibold text-ink hover:bg-lavender">
                Log in
              </Link>
              <Link href="/signup" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:px-6 sm:pt-20">
        <section className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold tracking-[0.3em] text-primary">YOUR DOCUMENTS, MORE DONE.</p>
          <h1 className="mt-4 text-4xl leading-tight font-bold tracking-tight sm:text-6xl">
            Turn your documents{" "}
            <span className="bg-gradient-to-r from-primary via-secondary to-blue-500 bg-clip-text text-transparent">
              into action.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted sm:text-lg">
            Dossify is your AI document assistant that understands, retrieves, and gets things done, all within your
            workspace.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-card hover:bg-primary-hover">
              Create a personal account
            </Link>
            <Link
              href="/signup?type=organization"
              className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-semibold text-ink hover:border-secondary/60"
            >
              Set up your organization
            </Link>
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-3xl border border-line bg-white p-6 shadow-card">
              <span className="grid size-10 place-items-center rounded-xl bg-lavender text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h2 className="mt-4 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-muted">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
