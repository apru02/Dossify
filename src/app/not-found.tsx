import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <LogoMark size={48} />
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        This page doesn&apos;t exist, or it belongs to a workspace you don&apos;t have access to.
      </p>
      <Link href="/dashboard" className="mt-6 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover">
        Back to Dossify
      </Link>
    </main>
  );
}
