import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic authentication check (Next.js 16 renamed Middleware to Proxy).
 *
 * This is **not** the authorization boundary — `src/app/(app)/layout.tsx` is, and it validates
 * the session against the database before any protected page renders. The Next.js docs warn
 * explicitly against using proxy as a session-management layer, and the reason applies here:
 * proxy runs in a lightweight runtime with no database access, so all it can see is whether a
 * session cookie is *present*, not whether it is valid.
 *
 * What it buys is worth having anyway:
 *
 *  - the visitor's intended destination is preserved in `?callbackUrl=`, which a layout
 *    cannot do because Server Components are not told the request path, and
 *  - an obviously-anonymous request is turned away before any rendering work happens.
 *
 * A forged or expired cookie gets past this check and is rejected by the layout a moment
 * later, which is the correct division of labour.
 */

/**
 * Auth.js prefixes the session cookie with `__Secure-` when it is issued over HTTPS, so both
 * spellings have to be considered — the secure one in production, the plain one locally.
 */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(request.cookies.get(name)?.value));
}

export function proxy(request: NextRequest) {
  // The development bypass grants a session with no cookie at all; skipping the check keeps
  // proxy from redirecting away from pages the layout would happily render.
  if (process.env["AUTH_DEV_BYPASS"] === "true" && process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  if (hasSessionCookie(request)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Only the protected areas. Auth.js routes, static assets and the public SDK bundle must
  // never be intercepted — redirecting the OAuth callback would break sign-in entirely.
  // Mirrors PROTECTED_PREFIXES in lib/routes.ts (a matcher must be a static literal): the
  // project area, Manage projects, and every legacy prefix that now redirects into them.
  matcher: [
    "/p/:path*",
    "/projects/:path*",
    "/get-started/:path*",
    "/websites/:path*",
    "/experiments/:path*",
    "/metrics/:path*",
    "/integrations/:path*",
  ],
};
