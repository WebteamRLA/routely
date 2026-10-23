import "server-only";

import type { MemberRole } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { workspaceAccess } from "@/server/repositories/access";

/**
 * Data access for memberships.
 *
 * Reads are scoped to workspaces the actor belongs to. Writes carry the actor's required roles
 * *and* the target rules (never the Owner, never the actor themselves) in their own `where`
 * clause, so the rules hold even if a service check were skipped.
 */

export interface MemberRow {
  id: string;
  userId: string;
  role: MemberRole;
  lastActiveAt: Date | null;
  createdAt: Date;
  user: { name: string | null; email: string };
}

const memberSelect = {
  id: true,
  userId: true,
  role: true,
  lastActiveAt: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
} as const;

/** The members of a workspace — empty unless `actorUserId` is one of them. */
export function listMembers(
  workspaceId: string,
  actorUserId: string,
  client: DbClient = db,
): Promise<MemberRow[]> {
  return client.membership.findMany({
    where: { workspaceId, workspace: workspaceAccess(actorUserId) },
    orderBy: { createdAt: "asc" },
    select: memberSelect,
  });
}

export interface MembershipInActorWorkspace extends MemberRow {
  workspaceId: string;
  workspace: { name: string };
  /** The actor's own role in that workspace. */
  actorRole: MemberRole;
}

/** A membership in a workspace the actor belongs to, with the actor's role there. */
export async function findMembershipForActor(
  membershipId: string,
  actorUserId: string,
  client: DbClient = db,
): Promise<MembershipInActorWorkspace | null> {
  const row = await client.membership.findFirst({
    where: { id: membershipId, workspace: workspaceAccess(actorUserId) },
    select: {
      ...memberSelect,
      workspaceId: true,
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
  return { ...row, workspace: { name: row.workspace.name }, actorRole };
}

/**
 * Sets a member's role. Matches only when the target is not the Owner, is not the actor, the new
 * role is not OWNER, and the actor holds one of `actorRoles` in the workspace.
 */
export async function updateMemberRole(
  membershipId: string,
  actorUserId: string,
  role: Exclude<MemberRole, "OWNER">,
  actorRoles: readonly MemberRole[],
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.membership.updateMany({
    where: {
      id: membershipId,
      role: { not: "OWNER" },
      userId: { not: actorUserId },
      workspace: workspaceAccess(actorUserId, { roles: actorRoles }),
    },
    data: { role },
  });
  return count === 1;
}

/** Deletes a membership under the same rules as `updateMemberRole`. The user row is untouched. */
export async function deleteMember(
  membershipId: string,
  actorUserId: string,
  actorRoles: readonly MemberRole[],
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.membership.deleteMany({
    where: {
      id: membershipId,
      role: { not: "OWNER" },
      userId: { not: actorUserId },
      workspace: workspaceAccess(actorUserId, { roles: actorRoles }),
    },
  });
  return count === 1;
}

/** Lower-cased emails of everyone in a workspace — for the invite rules. Not actor-scoped: the
 * caller has already established the actor's membership. */
export async function memberEmails(workspaceId: string, client: DbClient = db): Promise<string[]> {
  const rows = await client.membership.findMany({
    where: { workspaceId },
    select: { user: { select: { email: true } } },
  });
  return rows.map((r) => r.user.email.toLowerCase());
}
