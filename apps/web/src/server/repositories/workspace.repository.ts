import "server-only";

import type { MemberRole } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { actorMembershipSelect, workspaceAccess } from "@/server/repositories/access";

/**
 * Data access for workspaces. Every read is filtered by the actor's membership (`access.ts`), so a
 * workspace the actor does not belong to is indistinguishable from one that does not exist.
 */

export interface WorkspaceForMember {
  id: string;
  name: string;
  /** The actor's role here. */
  role: MemberRole;
  projectCount: number;
}

/** One workspace the user belongs to, with their role and its project count. */
export async function findWorkspaceForMember(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<WorkspaceForMember | null> {
  const row = await client.workspace.findFirst({
    where: { id: workspaceId, ...workspaceAccess(userId) },
    select: {
      id: true,
      name: true,
      ...actorMembershipSelect(userId),
      _count: { select: { websites: true } },
    },
  });
  const role = row?.memberships[0]?.role;
  if (!row || !role) return null;
  return { id: row.id, name: row.name, role, projectCount: row._count.websites };
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: MemberRole;
}

/** Every workspace the user belongs to, in the order they joined (their own first). */
export async function listWorkspacesForUser(
  userId: string,
  client: DbClient = db,
): Promise<WorkspaceSummary[]> {
  const rows = await client.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, workspace: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.workspace.id, name: r.workspace.name, role: r.role }));
}

/**
 * Makes `workspaceId` the user's current workspace — only when they are a member of it. The
 * membership filter is part of the write, so a forged id changes nothing. Returns whether it did.
 */
export async function setCurrentWorkspace(
  userId: string,
  workspaceId: string,
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.user.updateMany({
    where: { id: userId, memberships: { some: { workspaceId } } },
    data: { currentWorkspaceId: workspaceId },
  });
  return count === 1;
}
