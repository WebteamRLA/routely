import "server-only";

import { randomBytes } from "node:crypto";

import type { MemberRole, Prisma, SiteProtocol, Website } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { actorMembershipSelect, websiteAccess } from "@/server/repositories/access";

/**
 * Data access for websites.
 *
 * Repositories own queries and nothing else — no business rules. What makes them safe is that
 * every ownership-sensitive function takes the actor's `userId` and folds a workspace-membership
 * filter (`access.ts`) into the `where` clause, so a caller cannot accidentally omit the tenant
 * filter. Writes also take the roles allowed to make them, so the role check participates in the
 * write itself.
 */

/** Length in bytes of the random component of a public site id. */
const PUBLIC_SITE_ID_BYTES = 16;

/**
 * Generates a public site id: `rt_` plus 32 hex characters (128 bits).
 *
 * The value is public by design — it ships in the page source of every installed snippet —
 * so this is not about secrecy. It uses `randomBytes` rather than `Math.random` because a
 * *guessable* id would let anyone append events to another customer's website, which would
 * corrupt their results even though it grants no read access.
 */
export function generatePublicSiteId(): string {
  return `rt_${randomBytes(PUBLIC_SITE_ID_BYTES).toString("hex")}`;
}

/** The websites of one workspace, newest first — only if `userId` is a member of it. */
export function listWebsitesInWorkspace(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<Website[]> {
  return client.website.findMany({
    where: websiteAccess(userId, { workspaceId }),
    orderBy: { createdAt: "desc" },
  });
}

/** A website in any workspace the user belongs to. */
export function findWebsiteForUser(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Website | null> {
  return client.website.findFirst({
    where: { id: websiteId, ...websiteAccess(userId) },
  });
}

/**
 * A website the user can see, together with the role they hold in its workspace — what a service
 * needs to tell "does not exist" (NOT_FOUND) from "exists, but you may not" (FORBIDDEN).
 */
export async function findWebsiteAccess(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<{ website: Website; role: MemberRole } | null> {
  const row = await client.website.findFirst({
    where: { id: websiteId, ...websiteAccess(userId) },
    include: { workspace: { select: actorMembershipSelect(userId) } },
  });

  const role = row?.workspace.memberships[0]?.role;
  if (!row || !role) return null;

  const { workspace: _workspace, ...website } = row;
  return { website, role };
}

/** Resolves the website a tracking request belongs to. Used by the public SDK endpoints. */
export function findWebsiteByPublicSiteId(
  publicSiteId: string,
  client: DbClient = db,
): Promise<Website | null> {
  return client.website.findUnique({
    where: { publicSiteId },
  });
}

/**
 * Bumps `lastSeenAt` from a site-wide SDK hit — a throttled compare-and-set.
 *
 * The condition lives in the WHERE clause of the write itself (`lastSeenAt` is null or older
 * than `throttleMs`), so a burst of concurrent hits produces at most one write per interval and
 * no hit ever has to read the row first. A read-then-write would let every concurrent hit see
 * the old value and each issue an update. Returns whether this call won the write.
 *
 * Unscoped by user on purpose: the caller is the public hit endpoint, and `websiteId` is the
 * website it resolved from the public site id, never a value from the payload.
 */
export async function touchLastSeen(
  websiteId: string,
  now: Date,
  throttleMs: number,
  client: DbClient = db,
): Promise<boolean> {
  // Raw rather than `updateMany` so `updatedAt` keeps meaning "the customer edited this website":
  // Prisma's `@updatedAt` would otherwise move on every visitor's hit.
  const cutoff = new Date(now.getTime() - throttleMs);
  const count = await client.$executeRaw`
    UPDATE "websites" SET "lastSeenAt" = ${now}
    WHERE "id" = ${websiteId} AND ("lastSeenAt" IS NULL OR "lastSeenAt" < ${cutoff})
  `;
  return count > 0;
}

export function createWebsite(
  data: {
    workspaceId: string;
    createdById: string;
    name: string;
    domain: string;
    protocol: SiteProtocol;
    publicSiteId: string;
  },
  client: DbClient = db,
): Promise<Website> {
  return client.website.create({ data });
}

export function updateWebsite(
  websiteId: string,
  userId: string,
  roles: readonly MemberRole[],
  data: Prisma.WebsiteUpdateManyMutationInput,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  // updateMany rather than update: it accepts a non-unique where clause, which lets the
  // tenant filter participate in the write itself instead of relying on a prior read.
  return client.website.updateMany({
    where: { id: websiteId, ...websiteAccess(userId, { roles }) },
    data,
  });
}

/**
 * Records that the snippet was seen on this website's pages.
 *
 * Scoped by owner like every other write here, so a websiteId from a form body cannot stamp
 * somebody else's record.
 */
export function markPixelVerified(
  websiteId: string,
  userId: string,
  roles: readonly MemberRole[],
  at: Date,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.updateMany({
    where: { id: websiteId, ...websiteAccess(userId, { roles }) },
    data: { pixelVerifiedAt: at },
  });
}

/**
 * Records that a tracking check found this website's own snippet in one of its pages — the same
 * evidence the pixel dialog's Verify stamps with `markPixelVerified`, reached by another path.
 *
 * Takes no actor, like `touchLastSeen`: it is called only by `tracking-check.service`'s `runCheck`,
 * whose website was already loaded through an access-filtered query (or by launch, which authorized
 * it), and it writes nothing but the evidence. Never moves the stamp backwards.
 */
export function recordSnippetFound(
  websiteId: string,
  at: Date,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.updateMany({
    where: { id: websiteId, OR: [{ pixelVerifiedAt: null }, { pixelVerifiedAt: { lt: at } }] },
    data: { pixelVerifiedAt: at },
  });
}

export function deleteWebsite(
  websiteId: string,
  userId: string,
  roles: readonly MemberRole[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.deleteMany({
    where: { id: websiteId, ...websiteAccess(userId, { roles }) },
  });
}

/**
 * Deletes several websites the user may delete. As with the single-row version, the tenant and
 * role filter participates in the write itself rather than relying on a prior read.
 */
export function deleteWebsites(
  websiteIds: string[],
  userId: string,
  roles: readonly MemberRole[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.deleteMany({
    where: { id: { in: websiteIds }, ...websiteAccess(userId, { roles }) },
  });
}

export function countExperiments(websiteId: string, client: DbClient = db): Promise<number> {
  return client.experiment.count({ where: { websiteId } });
}
