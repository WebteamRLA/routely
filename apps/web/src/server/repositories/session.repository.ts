import "server-only";

import { type DbClient, db } from "@/server/db";

/**
 * The `sessions` table, for password sign-in and Settings → "Where you're signed in".
 *
 * Every read and delete takes the actor's `userId` and puts it in the `where` clause, so a
 * session id from a form can only ever address one of the actor's own sessions — someone else's
 * id matches nothing. Deletes that must spare the current session put that exclusion in the same
 * filter rather than checking it first.
 */

export interface SessionOrigin {
  userAgent: string | null;
  city: string | null;
  country: string | null;
}

/** Inserts a session row exactly as the Auth.js adapter would, plus where it came from. */
export function insertSession(
  data: { sessionToken: string; userId: string; expires: Date } & SessionOrigin,
  client: DbClient = db,
) {
  return client.session.create({ data, select: { id: true } });
}

/** Unexpired sessions, most recently seen first. */
export function listActiveSessions(userId: string, now: Date, client: DbClient = db) {
  return client.session.findMany({
    where: { userId, expires: { gt: now } },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      lastSeenAt: true,
      userAgent: true,
      city: true,
      country: true,
    },
  });
}

/** One of the actor's own sessions, never the current one. */
export function findOtherSession(
  userId: string,
  sessionId: string,
  currentSessionId: string,
  client: DbClient = db,
) {
  return client.session.findFirst({
    where: { id: sessionId, userId, NOT: { id: currentSessionId } },
    select: { id: true, userAgent: true },
  });
}

/** Deletes one of the actor's sessions other than the current one. Returns how many went. */
export async function deleteOtherSession(
  userId: string,
  sessionId: string,
  currentSessionId: string,
  client: DbClient = db,
): Promise<number> {
  const result = await client.session.deleteMany({
    where: { id: sessionId, userId, NOT: { id: currentSessionId } },
  });
  return result.count;
}

/** Deletes every session of the actor's except the current one. */
export async function deleteOtherSessions(
  userId: string,
  currentSessionId: string,
  client: DbClient = db,
): Promise<number> {
  const result = await client.session.deleteMany({
    where: { userId, NOT: { id: currentSessionId } },
  });
  return result.count;
}

/** Signs a user out everywhere — after a password reset. */
export async function deleteAllSessions(userId: string, client: DbClient = db): Promise<number> {
  const result = await client.session.deleteMany({ where: { userId } });
  return result.count;
}
