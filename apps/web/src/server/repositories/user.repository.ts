import "server-only";

import { type DbClient, db } from "@/server/db";

/**
 * Data access for the actor's own `users` row.
 *
 * Every function here addresses one user by their own id (taken from the session) or by an email
 * the request supplied, so there is no tenant filter to fold in: a user is the tenant of their own
 * account. Nothing here is reachable with another user's id from a form.
 */

/** What password sign-in needs. Email is stored lower-case. */
export function findUserForSignIn(email: string, client: DbClient = db) {
  return client.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true, disabledAt: true },
  });
}

export function findUserById(userId: string, client: DbClient = db) {
  return client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      passwordHash: true,
      passwordChangedAt: true,
      disabledAt: true,
    },
  });
}

/** True when another account already uses `email`. */
export async function emailTaken(
  email: string,
  exceptUserId: string | null,
  client: DbClient = db,
): Promise<boolean> {
  const row = await client.user.findUnique({ where: { email }, select: { id: true } });
  return Boolean(row && row.id !== exceptUserId);
}

export async function updateName(userId: string, name: string, client: DbClient = db) {
  await client.user.updateMany({ where: { id: userId }, data: { name } });
}

/** Stores a new hash; `passwordChangedAt` drives "Last changed …". */
export async function setPassword(
  userId: string,
  passwordHash: string,
  at: Date,
  client: DbClient = db,
): Promise<void> {
  await client.user.updateMany({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: at },
  });
}

/**
 * Compare-and-set on the hash read a moment ago, so two concurrent changes cannot both succeed
 * against the same current password. True when this write won.
 */
export async function replacePassword(
  userId: string,
  expectedHash: string | null,
  passwordHash: string,
  at: Date,
  client: DbClient = db,
): Promise<boolean> {
  const result = await client.user.updateMany({
    where: { id: userId, passwordHash: expectedHash },
    data: { passwordHash, passwordChangedAt: at },
  });
  return result.count === 1;
}

/** Sets `emailVerified` once; an already-verified address keeps its original timestamp. */
export async function markEmailVerified(userId: string, at: Date, client: DbClient = db) {
  await client.user.updateMany({
    where: { id: userId, emailVerified: null },
    data: { emailVerified: at },
  });
}

/** The actor's role and workspace name, for "Owner of Fernwood Group". */
export function findMembershipLabel(userId: string, workspaceId: string, client: DbClient = db) {
  return client.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, workspace: { select: { name: true } } },
  });
}

/** True when `email` belongs to another member of the workspace — the design's own message. */
export async function emailBelongsToMember(
  workspaceId: string,
  email: string,
  exceptUserId: string,
  client: DbClient = db,
): Promise<boolean> {
  const row = await client.membership.findFirst({
    where: { workspaceId, user: { email }, NOT: { userId: exceptUserId } },
    select: { id: true },
  });
  return Boolean(row);
}
