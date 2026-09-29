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
    create: { websiteId, ...data, headerWrittenAt: null },
    update: { ...data, headerWrittenAt: null, attachedAt: new Date() },
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

/** Records that the header row now exists at this destination. */
export function markHeaderWritten(
  targetId: string,
  at: Date,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.websiteSheetTarget.updateMany({
    where: { id: targetId },
    data: { headerWrittenAt: at },
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
