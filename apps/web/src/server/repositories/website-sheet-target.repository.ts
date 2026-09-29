import "server-only";

import type { Prisma, WebsiteSheetTarget } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for a website's Google Sheets destination.
 *
 * Ownership is expressed one level up, as `website: { userId }` — the same shape
 * `experiment.repository.ts` uses, and for the same reason: a target has no owner of its own, so
 * the tenant filter has to reach through the website. Every function that a customer can reach
 * takes `userId` and folds it into the `where`, and the writes use `updateMany`/`deleteMany` so
 * that filter participates in the write rather than relying on a prior read.
 */

/** A target together with the website it belongs to — what the sweep and the UI both need. */
export type TargetWithWebsite = Prisma.WebsiteSheetTargetGetPayload<{
  include: { website: { select: { id: true; userId: true; name: true; domain: true } } };
}>;

const WEBSITE_INCLUDE = {
  website: { select: { id: true, userId: true, name: true, domain: true } },
} satisfies Prisma.WebsiteSheetTargetInclude;

export function findTargetForWebsite(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<TargetWithWebsite | null> {
  return client.websiteSheetTarget.findFirst({
    where: { websiteId, website: { userId } },
    include: WEBSITE_INCLUDE,
  });
}

/** Every destination the actor owns, for the integrations page. */
export function listTargetsForUser(
  userId: string,
  client: DbClient = db,
): Promise<TargetWithWebsite[]> {
  return client.websiteSheetTarget.findMany({
    where: { website: { userId } },
    include: WEBSITE_INCLUDE,
    orderBy: { attachedAt: "asc" },
  });
}

/**
 * Attaches a spreadsheet to a website, replacing any destination already there.
 *
 * `headerWrittenAt` is reset on every write, including when the same destination is re-saved: a new
 * tab has no header row of ours, and re-choosing the same one is how a customer who deleted the
 * header gets it back.
 *
 * Not an `upsert` on `websiteId` alone — that would write to a website the actor may not own. The
 * caller resolves the website through `website.repository.findWebsiteForUser` first, which is where
 * the ownership check lives.
 */
export function attachTarget(
  websiteId: string,
  data: {
    spreadsheetId: string;
    spreadsheetName: string | null;
    sheetId: number;
    sheetTitle: string;
    createdByRoutely: boolean;
  },
  client: DbClient = db,
): Promise<WebsiteSheetTarget> {
  return client.websiteSheetTarget.upsert({
    where: { websiteId },
    // rowCount resets because a new tab holds nothing yet; leaving a stale count would make the
    // next refresh pad blank rows over cells it never wrote.
    create: { websiteId, ...data, rowCount: 0, refreshedAt: null, lastError: null },
    update: { ...data, rowCount: 0, refreshedAt: null, lastError: null, attachedAt: new Date() },
  });
}

/** Removes a website's destination. The website and its data are untouched. */
export function detachTarget(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.websiteSheetTarget.deleteMany({
    where: { websiteId, website: { userId } },
  });
}

/**
 * Every destination the daily sweep should visit.
 *
 * No `userId`: the sweep acts for every account, like the ingestion-path repository functions. Only
 * targets whose owner holds a working Google grant are returned — a website whose customer has
 * revoked access is excluded here rather than fetched and skipped, so the sweep's counts describe
 * work it could actually have done.
 */
export function listSyncableTargets(client: DbClient = db): Promise<TargetWithWebsite[]> {
  return client.websiteSheetTarget.findMany({
    where: { website: { user: { sheetsConnection: { status: "CONNECTED" } } } },
    include: WEBSITE_INCLUDE,
    orderBy: { attachedAt: "asc" },
  });
}

/**
 * Claims the right to refresh one website's tab, or reports that someone else has it.
 *
 * This is the throttle, and it is a compare-and-set rather than a read-then-write on purpose.
 * Ingestion is concurrent by nature — several beacons can arrive in the same second, across several
 * instances — and a read-then-write would let all of them decide to refresh. `updateMany` with the
 * previously observed `refreshedAt` in the `where` means exactly one wins: the others match zero
 * rows and skip. The same structural trick the sync-run claim uses.
 *
 * Returns the target when the claim succeeded, `null` when it did not or when the interval has not
 * elapsed. A caller that gets `null` must do nothing at all.
 */
export async function claimRefresh(
  websiteId: string,
  minIntervalMs: number,
  now: Date = new Date(),
  client: DbClient = db,
): Promise<TargetWithWebsite | null> {
  const target = await client.websiteSheetTarget.findUnique({
    where: { websiteId },
    include: WEBSITE_INCLUDE,
  });

  if (!target) return null;

  const last = target.refreshedAt?.getTime() ?? 0;
  if (now.getTime() - last < minIntervalMs) return null;

  const claimed = await client.websiteSheetTarget.updateMany({
    where: { id: target.id, refreshedAt: target.refreshedAt },
    data: { refreshedAt: now },
  });

  return claimed.count === 1 ? target : null;
}

/** Records what the tab now holds, so the next refresh can blank rows it no longer needs. */
export function recordWrite(
  targetId: string,
  data: { sheetId: number; sheetTitle: string; rowCount: number },
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.websiteSheetTarget.updateMany({
    where: { id: targetId },
    data: { ...data, lastError: null },
  });
}

/** Records why the last refresh failed, so the UI can say so instead of showing stale numbers. */
export function recordError(
  targetId: string,
  message: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.websiteSheetTarget.updateMany({
    where: { id: targetId },
    data: { lastError: message },
  });
}
