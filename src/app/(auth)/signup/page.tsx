import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { type } = await searchParams;
  return <SignupForm initialKind={type === "organization" ? "organization" : "personal"} />;
}
