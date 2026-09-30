import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// getUser() asks the Supabase Auth server, so the result can be trusted (unlike getSession()).
// cache() dedupes it within one request (layout + page + actions).
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function displayName(user: User): string {
  const meta = user.user_metadata ?? {};
  return (meta.full_name as string) || (meta.name as string) || user.email?.split("@")[0] || "You";
}
