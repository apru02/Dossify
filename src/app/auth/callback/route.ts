import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/urls";

// Google OAuth (and PKCE email links) land here with ?code=... which we exchange for a session cookie.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  const reason = searchParams.get("error_description") ?? "We couldn't sign you in. Please try again.";
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, origin));
}
