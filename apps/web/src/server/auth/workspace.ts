import "server-only";

import type { MemberRole } from "@/generated/prisma/enums";
import { personalWorkspaceName } from "@/lib/workspace-name";
import { type DbClient, db } from "@/server/db";

/**
 * Workspace bootstrap and resolution for the session seam.
 *
 * Every user has at least one workspace: their own, created with the account (see `adapter.ts`).
 * These functions are what the session seam uses to decide *which* workspace a request acts in,
 * and to repair the one state that would otherwise leave a signed-in user with nowhere to be —
 * having no membership at all.
 */

/** How stale `Membership.lastActiveAt` may get before a request refreshes it. */
const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;

export interface ActiveMembership {
  membershipId: string;
  workspaceId: string;
  role: MemberRole;
}

/**
 * Creates "{First}’s workspace" with `user` as its OWNER and makes it their current workspace.
 *
 * Takes a transaction client so the caller decides the boundary — the adapter creates the user and
 * this in one transaction, so an account can never exist without a workspace.
 */
export async function createPersonalWorkspace(
  client: DbClient,
  user: { id: string; name: string | null; email: string },
): Promise<ActiveMembership> {
  const workspace = await client.workspace.create({
    data: {
      name: personalWorkspaceName(user.name, user.email),
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
    include: { memberships: { select: { id: true } } },
  });

  await client.user.update({
    where: { id: user.id },
    data: { currentWorkspaceId: workspace.id },
  });

  return {
    membershipId: workspace.memberships[0]!.id,
    workspaceId: workspace.id,
    role: "OWNER",
  };
}

/**
 * The workspace this user's requests act in.
 *
 * `User.currentWorkspaceId` when the user is still a member there; otherwise the oldest membership
 * they hold (and that becomes current); otherwise — removed from every workspace, or an account that
 * predates workspaces and slipped past the migration — a fresh personal workspace.
 *
 * Costs one indexed read in the common case. The membership is re-checked on every request rather
 * than trusted from the user row, so removing someone from a workspace takes effect immediately.
 */
export async function resolveActiveMembership(user: {
  id: string;
  name: string | null;
  email: string;
  currentWorkspaceId: string | null;
}): Promise<ActiveMembership> {
  if (user.currentWorkspaceId) {
    const current = await db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: user.currentWorkspaceId, userId: user.id } },
      select: { id: true, workspaceId: true, role: true, lastActiveAt: true },
    });

    if (current) {
      await touchMembership(current.id, current.lastActiveAt);
      return { membershipId: current.id, workspaceId: current.workspaceId, role: current.role };
    }
  }

  const oldest = await db.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, workspaceId: true, role: true, lastActiveAt: true },
  });

  if (oldest) {
    // Compare-and-set on the value just read, so two concurrent requests cannot fight over it.
    await db.user.updateMany({
      where: { id: user.id, currentWorkspaceId: user.currentWorkspaceId },
      data: { currentWorkspaceId: oldest.workspaceId },
    });
    await touchMembership(oldest.id, oldest.lastActiveAt);
    return { membershipId: oldest.id, workspaceId: oldest.workspaceId, role: oldest.role };
  }

  return db.$transaction(async (tx) => {
    // Serialise per user: two first requests arriving together must not create two workspaces.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace:${user.id}`}))`;

    const raced = await tx.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, workspaceId: true, role: true },
    });
    if (raced) {
      return { membershipId: raced.id, workspaceId: raced.workspaceId, role: raced.role };
    }

    return createPersonalWorkspace(tx, user);
  });
}

/** The user's role in a workspace, or null when they are not a member of it. */
export async function findRole(workspaceId: string, userId: string): Promise<MemberRole | null> {
  const membership = await db.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/**
 * Records "last active" for the Team tab — at most once per `ACTIVITY_THROTTLE_MS`, and as a
 * compare-and-set on the value already read, so a burst of requests writes once. Free when fresh:
 * the decision is made from the row the caller already loaded.
 */
async function touchMembership(membershipId: string, lastActiveAt: Date | null): Promise<void> {
  const now = Date.now();
  if (lastActiveAt && now - lastActiveAt.getTime() < ACTIVITY_THROTTLE_MS) return;

  await db.membership
    .updateMany({
      where: { id: membershipId, lastActiveAt },
      data: { lastActiveAt: new Date(now) },
    })
    .catch((error) => console.error("[routely] could not record membership activity", error));
}
