import "server-only";

import type { MemberRole, Prisma, WebsiteSheetTarget } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { websiteAccess } from "@/server/repositories/access";

/**
 * Data access for a website's Google Sheets destination.
 *
 * Tenancy is expressed through the website, as `website: websiteAccess(userId)` — the same shape
 * `experiment.repository.ts` uses, and for the same reason: a target has no tenant of its own, so
 * the filter has to reach through the website's workspace. Every function that a customer can
 * reach takes `userId` and folds it into the `where`, and the writes use `updateMany`/`deleteMany`
 * so that filter participates in the write rather than relying on a prior read.
 */

/** A target together with the website it belongs to — what the sweep and the UI both need. */
export type TargetWithWebsite = Prisma.WebsiteSheetTargetGetPayload<{
  include: { website: { select: { id: true; workspaceId: true; name: true; domain: true } } };
}>;

const WEBSITE_INCLUDE = {
  website: { select: { id: true, workspaceId: true, name: true, domain: true } },
} satisfies Prisma.WebsiteSheetTargetInclude;

export function findTargetForWebsite(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<TargetWithWebsite | null> {
  return client.websiteSheetTarget.findFirst({
    where: { websiteId, website: websiteAccess(userId) },
    include: WEBSITE_INCLUDE,
  });
}

/** Every destination in one workspace, for the integrations page. */
export function listTargetsInWorkspace(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<TargetWithWebsite[]> {
  return client.websiteSheetTarget.findMany({
    where: { website: websiteAccess(userId, { workspaceId }) },
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
 * caller resolves the website through `website.repository.findWebsiteAccess` first, which is where
 * the membership and role check lives.
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
    // A new destination starts with a clean slate, including the failure-notification latch.
    create: {
      websiteId,
      ...data,
      rowCount: 0,
      refreshedAt: null,
      lastError: null,
      errorNotifiedAt: null,
    },
    update: {
      ...data,
      rowCount: 0,
      refreshedAt: null,
      lastError: null,
      errorNotifiedAt: null,
      attachedAt: new Date(),
    },
  });
}

/** Removes a website's destination. The website and its data are untouched. */
export function detachTarget(
  websiteId: string,
  userId: string,
  roles: readonly MemberRole[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.websiteSheetTarget.deleteMany({
    where: { websiteId, website: websiteAccess(userId, { roles }) },
  });
}

/**
 * Every destination the daily sweep should visit.
 *
 * No `userId`: the sweep acts for every workspace, like the ingestion-path repository functions.
 * Only targets whose workspace holds a working Google grant are returned — a website whose customer has
 * revoked access is excluded here rather than fetched and skipped, so the sweep's counts describe
 * work it could actually have done.
 */
export function listSyncableTargets(client: DbClient = db): Promise<TargetWithWebsite[]> {
  return client.websiteSheetTarget.findMany({
    where: { website: { workspace: { sheetsConnection: { status: "CONNECTED" } } } },
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

/**
 * Records what the tab now holds, so the next refresh can blank rows it no longer needs.
 *
 * A success also clears the failure and re-arms the SHEETS_SYNC_FAILED latch, so the *next*
 * failure is announced again.
 */
export function recordWrite(
  targetId: string,
  data: { sheetId: number; sheetTitle: string; rowCount: number },
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.websiteSheetTarget.updateMany({
    where: { id: targetId },
    data: { ...data, lastError: null, errorNotifiedAt: null },
  });
}

/**
 * Claims the right to announce a failing sync — once per failure streak.
 *
 * A compare-and-set, like `claimRefresh`: the `errorNotifiedAt: null` in the `where` means exactly
 * one caller wins however many refreshes fail concurrently (beacons on several instances, the cron
 * and a "Sync now" at once). `recordWrite` clears the column on the next success, which re-arms it.
 * `lastError: { not: null }` keeps a claim from landing after a success that raced it.
 *
 * True when this caller won and must send the notification; false otherwise.
 */
export async function claimErrorNotification(
  targetId: string,
  now: Date = new Date(),
  client: DbClient = db,
): Promise<boolean> {
  const claimed = await client.websiteSheetTarget.updateMany({
    where: { id: targetId, errorNotifiedAt: null, lastError: { not: null } },
    data: { errorNotifiedAt: now },
  });

  return claimed.count === 1;
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
