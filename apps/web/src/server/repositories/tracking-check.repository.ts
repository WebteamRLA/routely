import "server-only";

import type { TrackingCheck, TrackingCheckResult } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * The cached snippet/reachability check per website URL (`tracking_checks`).
 *
 * Keyed by the server-normalised URL, so changing a URL changes its key and an old check can
 * never vouch for a page it did not look at. Not tenant-scoped: `tracking-check.service` resolves
 * the website through an access-filtered query before calling anything here.
 */

export interface TrackingCheckWrite {
  websiteId: string;
  urlKey: string;
  result: TrackingCheckResult;
  method: string | null;
  pageLoaded: boolean;
  httpStatus: number | null;
  detail: string | null;
  checkedAt: Date;
}

/** Insert or replace the check for `(websiteId, urlKey)` — the unique key makes it idempotent. */
export function upsertTrackingCheck(
  data: TrackingCheckWrite,
  client: DbClient = db,
): Promise<TrackingCheck> {
  const { websiteId, urlKey, ...fields } = data;
  return client.trackingCheck.upsert({
    where: { websiteId_urlKey: { websiteId, urlKey } },
    create: data,
    update: fields,
  });
}

/** The stored checks for these URL keys of one website. Missing keys are simply absent. */
export function findTrackingChecks(
  websiteId: string,
  urlKeys: readonly string[],
  client: DbClient = db,
): Promise<TrackingCheck[]> {
  if (urlKeys.length === 0) return Promise.resolve([]);
  return client.trackingCheck.findMany({
    where: { websiteId, urlKey: { in: [...urlKeys] } },
  });
}
