import type { Metadata } from "next";
import { safeNext } from "@/lib/urls";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 200) : undefined;
  return <LoginForm next={safeNext(sp.next)} initialError={error} />;
}
