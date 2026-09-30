import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

const PROTECTED_PREFIXES = ["/dashboard", "/w/", "/onboarding"];
const AUTH_PAGES = ["/login", "/signup"];

// Refreshes the Supabase session cookie on every request and does coarse route gating.
// Real authorization happens in pages/actions (getUser + RLS); this is only for UX.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // getClaims() verifies the JWT and refreshes it if needed. Don't put code between
  // createServerClient and this call, or users can be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;

  if (!signedIn && PROTECTED_PREFIXES.some((p) => path.startsWith(p))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return copyCookies(response, NextResponse.redirect(login));
  }

  if (signedIn && AUTH_PAGES.includes(path)) {
    const dash = request.nextUrl.clone();
    dash.pathname = "/dashboard";
    dash.search = "";
    return copyCookies(response, NextResponse.redirect(dash));
  }

  // Remember the last workspace the user opened, so /dashboard can send them back to it.
  const ws = path.match(/^\/w\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  if (signedIn && ws) {
    response.cookies.set("dossify_ws", ws, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 180 });
  }

  return response;
}

// Carry refreshed auth cookies (and their no-cache headers) over to a redirect response.
function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
  for (const h of ["cache-control", "expires", "pragma"]) {
    const v = from.headers.get(h);
    if (v) to.headers.set(h, v);
  }
  return to;
}
