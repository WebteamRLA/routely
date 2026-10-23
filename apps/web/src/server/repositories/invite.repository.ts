import "server-only";

import type { MemberRole } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { workspaceAccess } from "@/server/repositories/access";

/**
 * Data access for workspace invitations.
 *
 * Only the SHA-256 of an invite token is stored; the raw token exists in the email and nowhere
 * else, so a database read cannot be turned into a working link. Writes made on behalf of a
 * workspace member carry the membership-and-role filter in their own `where` clause.
 *
 * "Pending" means unaccepted and unrevoked. A partial unique index allows one pending invite per
 * (workspace, email); an expired one is still pending until replaced or revoked.
 */

export interface InviteRow {
  id: string;
  workspaceId: string;
  email: string;
  role: MemberRole;
  sentAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedBy: { name: string | null; email: string } | null;
}

const inviteSelect = {
  id: true,
  workspaceId: true,
  email: true,
  role: true,
  sentAt: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  invitedBy: { select: { name: true, email: true } },
} as const;

const pending = { acceptedAt: null, revokedAt: null } as const;

/** Pending invites of a workspace the actor belongs to, oldest first. */
export function listPendingInvites(
  workspaceId: string,
  actorUserId: string,
  client: DbClient = db,
): Promise<InviteRow[]> {
  return client.workspaceInvite.findMany({
    where: { workspaceId, ...pending, workspace: workspaceAccess(actorUserId) },
    orderBy: { createdAt: "asc" },
    select: inviteSelect,
  });
}

/** Pending invites for these addresses in a workspace (caller has established membership). */
export function findPendingByEmails(
  workspaceId: string,
  emails: readonly string[],
  client: DbClient = db,
): Promise<{ id: string; email: string; expiresAt: Date }[]> {
  return client.workspaceInvite.findMany({
    where: { workspaceId, email: { in: [...emails] }, ...pending },
    select: { id: true, email: true, expiresAt: true },
  });
}

/** Invites sent (or re-sent) by a workspace since `since` — the daily cap. */
export function countSentSince(
  workspaceId: string,
  since: Date,
  client: DbClient = db,
): Promise<number> {
  return client.workspaceInvite.count({ where: { workspaceId, sentAt: { gte: since } } });
}

/** A pending invite in a workspace the actor belongs to, with the actor's role there. */
export async function findPendingInviteForActor(
  inviteId: string,
  actorUserId: string,
  client: DbClient = db,
): Promise<(InviteRow & { workspaceName: string; actorRole: MemberRole }) | null> {
  const row = await client.workspaceInvite.findFirst({
    where: { id: inviteId, ...pending, workspace: workspaceAccess(actorUserId) },
    select: {
      ...inviteSelect,
      workspace: {
        select: {
          name: true,
          memberships: { where: { userId: actorUserId }, select: { role: true }, take: 1 },
        },
      },
    },
  });
  const actorRole = row?.workspace.memberships[0]?.role;
  if (!row || !actorRole) return null;
  const { workspace, ...invite } = row;
  return { ...invite, workspaceName: workspace.name, actorRole };
}

/** Revokes the given pending invites of a workspace — used to replace expired ones. */
export async function revokePendingByIds(
  workspaceId: string,
  ids: readonly string[],
  client: DbClient = db,
): Promise<number> {
  if (!ids.length) return 0;
  const { count } = await client.workspaceInvite.updateMany({
    where: { workspaceId, id: { in: [...ids] }, ...pending },
    data: { revokedAt: new Date() },
  });
  return count;
}

export interface NewInvite {
  email: string;
  role: Exclude<MemberRole, "OWNER">;
  tokenHash: string;
  expiresAt: Date;
}

export async function createInvites(
  workspaceId: string,
  invitedById: string,
  invites: readonly NewInvite[],
  client: DbClient = db,
): Promise<void> {
  await client.workspaceInvite.createMany({
    data: invites.map((i) => ({ ...i, workspaceId, invitedById })),
  });
}

/**
 * Gives a pending invite a new token and expiry (the old link stops working). Matches only when the
 * actor holds one of `actorRoles` in its workspace.
 */
export async function rotateInvite(
  inviteId: string,
  actorUserId: string,
  actorRoles: readonly MemberRole[],
  data: { tokenHash: string; sentAt: Date; expiresAt: Date },
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.workspaceInvite.updateMany({
    where: {
      id: inviteId,
      ...pending,
      workspace: workspaceAccess(actorUserId, { roles: actorRoles }),
    },
    data,
  });
  return count === 1;
}

export async function revokeInvite(
  inviteId: string,
  actorUserId: string,
  actorRoles: readonly MemberRole[],
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.workspaceInvite.updateMany({
    where: {
      id: inviteId,
      ...pending,
      workspace: workspaceAccess(actorUserId, { roles: actorRoles }),
    },
    data: { revokedAt: new Date() },
  });
  return count === 1;
}

export interface InviteByToken extends InviteRow {
  workspace: { id: string; name: string };
}

/** Any invite, in any state, by the hash of its token. The token itself is the credential. */
export function findInviteByTokenHash(
  tokenHash: string,
  client: DbClient = db,
): Promise<InviteByToken | null> {
  return client.workspaceInvite.findUnique({
    where: { tokenHash },
    select: { ...inviteSelect, workspace: { select: { id: true, name: true } } },
  });
}

/**
 * Marks an invite accepted — only while it is still pending and unexpired, so two concurrent
 * accepts (or an accept racing a revoke) resolve to exactly one winner.
 */
export async function markAccepted(
  inviteId: string,
  userId: string,
  now: Date,
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.workspaceInvite.updateMany({
    where: { id: inviteId, ...pending, expiresAt: { gt: now } },
    data: { acceptedAt: now, acceptedById: userId },
  });
  return count === 1;
}
