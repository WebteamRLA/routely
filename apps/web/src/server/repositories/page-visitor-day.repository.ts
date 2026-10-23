import "server-only";

import { type DbClient, db } from "@/server/db";

/**
 * Per-page daily visitors: one `page_visitor_days` row per website × normalised URL × UTC day ×
 * browser. Serves the page traffic baseline ("~120 visitors a day") and the "seen" fallback of a
 * tracking check, for pages whose snippet is injected by a tag manager and so is absent from the
 * fetched HTML.
 *
 * `urlKey` is always the **server's** `normalizeUrl` of the URL — never the client's spelling.
 * Not tenant-scoped here; see `visitor-day.repository.ts`.
 */

/** Records that this browser viewed this page on `day`. A repeat is a no-op (ON CONFLICT DO NOTHING). */
export async function insertPageVisitorDay(
  row: { websiteId: string; urlKey: string; day: Date; anonymousId: string },
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.pageVisitorDay.createMany({ data: [row], skipDuplicates: true });
  return count > 0;
}

/** Visitor-days recorded for one page over `[from, to]`. */
export function countPageVisitorDays(
  websiteId: string,
  urlKey: string,
  from: Date,
  to: Date,
  client: DbClient = db,
): Promise<number> {
  return client.pageVisitorDay.count({
    where: { websiteId, urlKey, day: { gte: from, lte: to } },
  });
}

/** True when the page reported at least one hit on or after `since` (a UTC midnight). */
export async function pageSeenSince(
  websiteId: string,
  urlKey: string,
  since: Date,
  client: DbClient = db,
): Promise<boolean> {
  const row = await client.pageVisitorDay.findFirst({
    where: { websiteId, urlKey, day: { gte: since } },
    select: { day: true },
  });
  return row !== null;
}

/** Deletes rows older than `before` (the 400-day retention, run by the daily cron). */
export async function prunePageVisitorDays(before: Date, client: DbClient = db): Promise<number> {
  const { count } = await client.pageVisitorDay.deleteMany({ where: { day: { lt: before } } });
  return count;
}
