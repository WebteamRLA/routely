import "server-only";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";

import { env } from "@/env";
import { db } from "@/server/db";
import { type SessionOrigin, insertSession } from "@/server/repositories/session.repository";

/**
 * Sessions for email + password sign-in — the same database sessions Google sign-in gets.
 *
 * Auth.js's Credentials provider only works with JWT sessions, and this app depends on database
 * sessions: signing out deletes the row, Settings lists and revokes them, a password reset ends
 * them all. So password sign-in does not go through Auth.js at all. It writes the `sessions` row
 * the Prisma adapter would have written and sets the cookie Auth.js reads; from the next request
 * on, `auth()` resolves it exactly like a Google session and nothing downstream can tell the
 * difference. Matching Auth.js precisely is the whole job of this module:
 *
 * - **token**: `crypto.randomUUID()`, Auth.js's default `generateSessionToken`;
 * - **expiry**: `SESSION_MAX_AGE_SECONDS`, the value `config.ts` passes as `session.maxAge`;
 * - **cookie**: `authjs.session-token`, or `__Secure-authjs.session-token` when the app's origin is
 *   https — `@auth/core`'s `defaultCookies(useSecureCookies)`, where `useSecureCookies` is
 *   `url.protocol === "https:"` and the URL is `AUTH_URL` when set (`next-auth/lib/env.js`) —
 *   HttpOnly, SameSite=Lax, Path=/.
 */

/** 30 days. `config.ts` uses this as Auth.js's `session.maxAge` so the two can never drift. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const COOKIE_BASE = "authjs.session-token";

/** Longest User-Agent stored. Real ones are ~150 characters; anything far longer is junk. */
const USER_AGENT_MAX = 512;

/** Whether Auth.js issues (and so reads) the `__Secure-` cookie on this deployment. */
async function usesSecureCookies(): Promise<boolean> {
  const configured = process.env["AUTH_URL"] ?? process.env["NEXTAUTH_URL"];
  if (configured) {
    try {
      return new URL(configured).protocol === "https:";
    } catch {
      // Fall through to the request.
    }
  }
  // No AUTH_URL: Auth.js uses the request URL, which behind a proxy reflects X-Forwarded-Proto.
  const list = await headers();
  const proto = list.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return (env.AUTH_URL ?? "").startsWith("https:");
}

export async function sessionCookieName(): Promise<string> {
  return (await usesSecureCookies()) ? `__Secure-${COOKIE_BASE}` : COOKIE_BASE;
}

/**
 * Where the request came from — the User-Agent, and the city and country when the platform
 * supplies them. The same rules as the Google path in `adapter.ts`: display-only, never used for
 * an access decision, no raw IP stored.
 */
export async function requestOrigin(): Promise<SessionOrigin> {
  try {
    const list = await headers();
    const city = list.get("x-vercel-ip-city");
    const country = list.get("x-vercel-ip-country");
    let decodedCity: string | null = null;
    if (city) {
      try {
        decodedCity = decodeURIComponent(city).slice(0, 100);
      } catch {
        decodedCity = null;
      }
    }
    return {
      userAgent: list.get("user-agent")?.slice(0, USER_AGENT_MAX) ?? null,
      city: decodedCity,
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    };
  } catch {
    return { userAgent: null, city: null, country: null };
  }
}

/**
 * Signs `userId` in on this browser: inserts the session row and sets the cookie. For Server
 * Actions only (cookies can be written there and in route handlers, not during render).
 *
 * A session cookie already on the request is retired first, so signing in again — as the same or
 * another account — does not leave an orphaned row behind in "Where you're signed in".
 */
export async function startPasswordSession(
  userId: string,
): Promise<{ sessionId: string; origin: SessionOrigin }> {
  const jar = await cookies();
  const name = await sessionCookieName();

  const previous = jar.get(name)?.value;
  if (previous) {
    await db.session.deleteMany({ where: { sessionToken: previous } });
  }

  const origin = await requestOrigin();
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const row = await insertSession({ sessionToken, userId, expires, ...origin });

  jar.set(name, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: name.startsWith("__Secure-"),
    expires,
  });

  return { sessionId: row.id, origin };
}
