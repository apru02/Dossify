import { FileText, Sparkles, Zap } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const features = [
  { icon: FileText, text: "Ask questions from your documents" },
  { icon: Sparkles, text: "Get accurate, cited answers" },
  { icon: Zap, text: "Take actions with AI tools" },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen">
      <aside className="brand-glow relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <Logo size={36} tone="light" />

        <div className="max-w-md space-y-8">
          <div className="space-y-4">
            <div className="h-1 w-10 rounded-full bg-secondary" />
            <h1 className="text-4xl leading-tight font-bold tracking-tight">Turn your documents into action.</h1>
            <p className="text-base leading-relaxed text-white/70">
              Dossify is your AI document assistant that understands, retrieves, and gets things done, all within
              your workspace.
            </p>
          </div>
          <ul className="space-y-3">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <span className="grid size-9 place-items-center rounded-xl bg-white/10">
                  <Icon className="size-4 text-accent" aria-hidden />
                </span>
                <span className="text-sm font-medium text-white/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs font-medium tracking-[0.3em] text-white/50">YOUR DOCUMENTS, MORE DONE.</p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-8 lg:hidden">
          <Logo size={36} />
        </div>
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  );
}
