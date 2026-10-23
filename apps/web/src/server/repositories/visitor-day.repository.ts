import "server-only";

import { type DbClient, db } from "@/server/db";

/**
 * Site-wide daily visitors: one `website_visitor_days` row per website × UTC day × browser.
 *
 * Rows, not counters — a visitor count is `count(*)` over this table, so it can never drift from
 * what was recorded. Written only by the public page hit (`ingest.service.recordHit`), keyed on
 * the website the *server* resolved from the public site id. Not tenant-scoped here: callers that
 * serve a signed-in user must have established access to `websiteId` first (the read models in
 * `lib/visitors.ts` take a website the caller already loaded through an access-filtered query).
 *
 * `day` is a `DATE` column; every `Date` passed in must be a UTC midnight.
 */

/** Records that this browser visited this website on `day`. A repeat is a no-op (ON CONFLICT DO NOTHING). */
export async function insertWebsiteVisitorDay(
  row: { websiteId: string; day: Date; anonymousId: string },
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.websiteVisitorDay.createMany({
    data: [row],
    skipDuplicates: true,
  });
  return count > 0;
}

/** Visitors per UTC day in `[from, to]` (inclusive day keys as UTC midnights). Days with none are absent. */
export async function countVisitorsByDay(
  websiteId: string,
  from: Date,
  to: Date,
  client: DbClient = db,
): Promise<{ day: Date; visitors: number }[]> {
  const rows = await client.websiteVisitorDay.groupBy({
    by: ["day"],
    where: { websiteId, day: { gte: from, lte: to } },
    _count: { _all: true },
  });
  return rows.map((row) => ({ day: row.day, visitors: row._count._all }));
}

/** Distinct browsers over `[from, to]` — a browser seen on several days counts once. */
export async function countDistinctVisitors(
  websiteId: string,
  from: Date,
  to: Date,
  client: DbClient = db,
): Promise<number> {
  const rows = await client.$queryRaw<{ n: number }[]>`
    SELECT count(DISTINCT "anonymousId")::int AS n
    FROM "website_visitor_days"
    WHERE "websiteId" = ${websiteId} AND "day" >= ${from}::date AND "day" <= ${to}::date
  `;
  return rows[0]?.n ?? 0;
}

/** Deletes rows older than `before` (the 400-day retention, run by the daily cron). */
export async function pruneWebsiteVisitorDays(
  before: Date,
  client: DbClient = db,
): Promise<number> {
  const { count } = await client.websiteVisitorDay.deleteMany({ where: { day: { lt: before } } });
  return count;
}
