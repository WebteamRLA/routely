import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma, SiteProtocol, Website } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for websites.
 *
 * Repositories own queries and nothing else — no authorization, no business rules. What makes
 * them safe is that every ownership-sensitive function takes `userId` and folds it into the
 * `where` clause, so a caller cannot accidentally omit the tenant filter.
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

export function listWebsitesForUser(userId: string, client: DbClient = db): Promise<Website[]> {
  return client.website.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export function findWebsiteForUser(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Website | null> {
  return client.website.findFirst({
    where: { id: websiteId, userId },
  });
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

export function createWebsite(
  data: {
    userId: string;
    name: string;
    domain: string;
    protocol: SiteProtocol;
    publicSiteId: string;
    timezone?: string;
    iconUrl?: string | null;
  },
  client: DbClient = db,
): Promise<Website> {
  return client.website.create({ data });
}

const DOMAINS_INCLUDE = {
  domains: { orderBy: { createdAt: "asc" as const }, select: { domain: true } },
} satisfies Prisma.WebsiteInclude;

export type WebsiteWithDomains = Prisma.WebsiteGetPayload<{ include: typeof DOMAINS_INCLUDE }>;

/** Every project the user owns — active and archived — newest first, with extra domains. */
export function listProjectsForUser(
  userId: string,
  client: DbClient = db,
): Promise<WebsiteWithDomains[]> {
  return client.website.findMany({
    where: { userId },
    // Creation order, as the design lists projects: the first project stays first, so `/`
    // with no remembered project opens the account's original project, not the newest.
    orderBy: { createdAt: "asc" },
    include: DOMAINS_INCLUDE,
  });
}

export function findProjectForUser(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<WebsiteWithDomains | null> {
  return client.website.findFirst({
    where: { id: websiteId, userId },
    include: DOMAINS_INCLUDE,
  });
}

/**
 * Which of the user's projects (other than `excludeId`) already use `domain`, as a primary or an
 * additional domain. Used for "Another project already uses this domain".
 */
export function findProjectUsingDomain(
  userId: string,
  domain: string,
  excludeId?: string,
  client: DbClient = db,
): Promise<{ id: string; name: string } | null> {
  return client.website.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ domain }, { domains: { some: { domain } } }],
    },
    select: { id: true, name: true },
  });
}

export function addDomain(
  websiteId: string,
  domain: string,
  client: DbClient = db,
): Promise<{ id: string; domain: string }> {
  return client.websiteDomain.create({
    data: { websiteId, domain },
    select: { id: true, domain: true },
  });
}

/** Removes an additional domain. Scoped by owner through the parent website. */
export function removeDomain(
  websiteId: string,
  userId: string,
  domain: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.websiteDomain.deleteMany({
    where: { websiteId, domain, website: { userId } },
  });
}

/** Latest experiment `updatedAt` per website, for "Last activity". */
export async function lastExperimentActivity(
  userId: string,
  client: DbClient = db,
): Promise<Map<string, Date>> {
  const rows = await client.experiment.groupBy({
    by: ["websiteId"],
    where: { website: { userId } },
    _max: { updatedAt: true },
  });
  return new Map(
    rows.flatMap((row) => (row._max.updatedAt ? [[row.websiteId, row._max.updatedAt]] : [])),
  );
}

export function updateWebsite(
  websiteId: string,
  userId: string,
  data: Prisma.WebsiteUpdateInput,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  // updateMany rather than update: it accepts a non-unique where clause, which lets the
  // tenant filter participate in the write itself instead of relying on a prior read.
  return client.website.updateMany({
    where: { id: websiteId, userId },
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
  at: Date,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.updateMany({
    where: { id: websiteId, userId },
    data: { pixelVerifiedAt: at },
  });
}

export function deleteWebsite(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.deleteMany({
    where: { id: websiteId, userId },
  });
}
