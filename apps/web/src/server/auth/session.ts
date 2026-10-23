import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { env } from "@/env";
import { type MemberRole, hasRole } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import { db } from "@/server/db";
import { forbidden, unauthenticated } from "@/server/errors";
import { auth } from "@/server/auth";
import { resolveActiveMembership } from "@/server/auth/workspace";

/**
 * The session seam.
 *
 * Every protected page, Server Action and route handler resolves the current user through
 * this module and nothing else, so the rest of the codebase never imports Auth.js directly.
 *
 * `auth()` reads the session cookie and, under the database strategy, loads the session row
 * from Postgres. Reading the request that way is also what marks every protected route as
 * dynamically rendered — without it Next.js would try to prerender per-user pages at build
 * time, where no session exists.
 *
 * It also decides which **workspace** the request acts in and the actor's role there. Membership is
 * re-read on every request (one indexed lookup), never cached in the cookie, so removing a member
 * or changing their role takes effect on their very next request.
 */

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  /** The `sessions` row behind this request. Null under the development bypass, which has none. */
  sessionId: string | null;
  /** The active workspace: `User.currentWorkspaceId`, or the oldest membership. */
  workspaceId: string;
  /** The actor's role in `workspaceId`. A record in another workspace carries its own role. */
  role: MemberRole;
}

export interface Session {
  user: SessionUser;
}

/**
 * Development-only placeholder identity, used when `AUTH_DEV_BYPASS` is set so the dashboard
 * can be worked on without Google credentials. `src/env.ts` forces the flag off whenever
 * NODE_ENV is "production", so this can never grant access to a deployed instance.
 */
const DEV_USER_EMAIL = "dev@routely.local";

/**
 * Resolves the bypass identity to a **real** `users` row.
 *
 * The row has to exist: websites and experiments are foreign-keyed to a user, so a fabricated
 * id would let the dashboard render and then fail on the first write. The promise is cached
 * at module scope so this costs one query per server process rather than one per request.
 */
let devUser: Promise<Omit<SessionUser, "workspaceId" | "role">> | null = null;

function resolveDevUser(): Promise<Omit<SessionUser, "workspaceId" | "role">> {
  devUser ??= db.user
    .upsert({
      where: { email: DEV_USER_EMAIL },
      create: { email: DEV_USER_EMAIL, name: "Local Developer" },
      update: {},
    })
    .then((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      sessionId: null,
    }))
    .catch((error) => {
      // Do not cache a failure — the database may simply not be running yet.
      devUser = null;
      throw error;
    });

  return devUser;
}

/**
 * Returns the current session, or `null` when the request is anonymous.
 *
 * Memoised per request with React's `cache`, so a layout and the page beneath it share one session
 * read and one membership lookup.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (env.AUTH_DEV_BYPASS) {
    const user = await resolveDevUser();
    // The bypass identity's workspace is resolved per request like anyone else's, so it follows a
    // workspace switch and survives its membership being removed.
    const fresh = await db.user.findUnique({
      where: { id: user.id },
      select: { currentWorkspaceId: true },
    });
    const membership = await resolveActiveMembership({
      ...user,
      currentWorkspaceId: fresh?.currentWorkspaceId ?? null,
    });
    return { user: { ...user, workspaceId: membership.workspaceId, role: membership.role } };
  }

  const session = await auth();

  // A session row can outlive its user — `email` is non-nullable in the schema, but the
  // Auth.js Session type allows it to be absent, so an incomplete session is treated as no
  // session rather than being coerced into a half-populated user.
  if (!session?.user?.id || !session.user.email || !session.sessionId) {
    return null;
  }

  const membership = await resolveActiveMembership({
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email,
    currentWorkspaceId: session.currentWorkspaceId ?? null,
  });

  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
      image: session.user.image ?? null,
      sessionId: session.sessionId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    },
  };
});

/**
 * Session accessor for pages and layouts: redirects anonymous visitors to the login screen,
 * preserving where they were headed so they can be returned there after signing in.
 */
export async function requireSession(returnTo?: string): Promise<Session> {
  const session = await getSession();

  if (!session) {
    const target = returnTo
      ? `${routes.login}?callbackUrl=${encodeURIComponent(returnTo)}`
      : routes.login;
    redirect(target);
  }

  return session;
}

/**
 * Session accessor for Server Actions and route handlers, where a redirect is the wrong
 * response and the caller needs a catchable error instead.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();

  if (!session) {
    throw unauthenticated();
  }

  return session.user;
}

/**
 * Session accessor that also requires a minimum role **in the active workspace**.
 *
 * For actions on the workspace itself (team, settings). An action on a particular record must
 * check the role the actor holds in *that record's* workspace instead, which the service does —
 * the record may live in a workspace other than the active one.
 */
export async function requireRole(min: MemberRole): Promise<SessionUser> {
  const user = await requireUser();

  if (!hasRole(user.role, min)) {
    throw forbidden();
  }

  return user;
}

/** True when Google sign-in is configured. Drives the login screen's fallback messaging. */
export function isAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_SECRET);
}
