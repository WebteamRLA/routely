import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { MemberRole } from "@/lib/permissions";

/**
 * Tenant filters — the one place the shape of "this user may see / change this row" is written.
 *
 * Authorization is structural: every ownership-sensitive repository function takes the actor's
 * `userId` and folds one of these into its `where` clause, and writes use `updateMany` /
 * `deleteMany` so the filter participates in the write itself rather than relying on a prior read.
 *
 * A row is reachable when the actor holds a membership in the row's workspace — optionally one of
 * `roles`. Membership decides *existence*: a non-member matches nothing and the service reports
 * NOT_FOUND. Role is checked by the service first (so a member lacking it gets FORBIDDEN, which
 * leaks nothing — they can already see the row) and then again here, in the write's own filter, so
 * a forgotten service check still matches nothing.
 */

export interface AccessOptions {
  /** Restrict to these roles. Omitted = any member (read access). */
  roles?: readonly MemberRole[];
  /**
   * Restrict to one workspace — the actor's current one, for lists. Combined with the membership
   * filter, never instead of it, so a forged workspace id still matches nothing.
   */
  workspaceId?: string;
}

export function workspaceAccess(
  userId: string,
  options: AccessOptions = {},
): Prisma.WorkspaceWhereInput {
  return {
    ...(options.workspaceId ? { id: options.workspaceId } : {}),
    memberships: {
      some: { userId, ...(options.roles ? { role: { in: [...options.roles] } } : {}) },
    },
  };
}

export function websiteAccess(
  userId: string,
  options: AccessOptions = {},
): Prisma.WebsiteWhereInput {
  return {
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    workspace: workspaceAccess(userId, { roles: options.roles }),
  };
}

export function experimentAccess(
  userId: string,
  options: AccessOptions = {},
): Prisma.ExperimentWhereInput {
  return { website: websiteAccess(userId, options) };
}

/** Selects the actor's own membership row alongside a workspace, to learn their role in one read. */
export function actorMembershipSelect(userId: string) {
  return {
    memberships: { where: { userId }, select: { role: true }, take: 1 },
  } satisfies Prisma.WorkspaceSelect;
}
