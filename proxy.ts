// ============================================================
// proxy.ts
//
// Optimistic auth redirects for browser navigation.
//
// NOT middleware.ts — that convention is deprecated in this version of
// Next.js and renamed to proxy.
//
// This deliberately does no more than check whether a session cookie is
// PRESENT. It does not verify the signature, read the database, or look
// at approval status, for two reasons the docs are explicit about:
// Proxy runs on prefetches too, so a database read here would multiply
// across links the user never clicks; and Proxy may be deployed to a
// CDN, so it must not depend on shared modules or app state.
//
// It is therefore a redirect convenience, NOT a security boundary — a
// forged cookie gets past it and straight into lib/auth/guard.ts, which
// is where the real decision happens. Nothing here is load-bearing.
// ============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth.js names the cookie differently over HTTPS. Both are checked
 * rather than branching on NODE_ENV so a production build behind a
 * local HTTP proxy still behaves.
 */
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

/**
 * Page prefixes that need a signed-in user.
 *
 * These mirror the guarded surfaces in lib/auth/guard.ts callers: the
 * three that spend money on Azure. The rest of the dashboard is plain
 * CRUD over our own database and stays public.
 */
const PROTECTED_PREFIXES = [
  "/dashboard/assistant",
  "/dashboard/knowledge",
  "/dashboard/forecasts",
  "/dashboard/admin",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some(
    (name) => request.cookies.get(name)?.value,
  );
  if (hasSession) return NextResponse.next();

  // Carry where they were going so login can send them back.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next's internals and static assets outright — matching them
  // would run this on every CSS and image request for no benefit. API
  // routes are excluded too: they guard themselves with status codes,
  // and a redirect to an HTML login page is the wrong answer to a fetch.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
