import "server-only";

import { normalizeUrl } from "@/lib/url";
import { type UtcDayKey, utcDayKey } from "@/lib/utc-day";
import * as pageVisitorDayRepo from "@/server/repositories/page-visitor-day.repository";
import * as visitorDayRepo from "@/server/repositories/visitor-day.repository";

/**
 * Site-wide visitor read models, derived from the page-hit rows (spec §1.4). One function per
 * number, so every screen that shows "visitors" means the same thing.
 *
 * Server-only (they query the database). They take a `websiteId` the caller has **already
 * authorized** — loaded through an access-filtered query — and add no tenant filter of their own.
 *
 * Days are UTC calendar days, like every other day in this codebase (`lib/utc-day.ts`). Windows
 * are inclusive of today: "the last 30 days" is today and the 29 days before it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The visitor window behind `visitors30` and `pageBaseline`. */
export const VISITOR_WINDOW_DAYS = 30;

/** Copy for a page with no hits in the window — `pageBaseline` returns null then. */
export const NO_TRAFFIC_ESTIMATE = "No traffic estimate yet";

export interface DailyVisitors {
  /** `YYYY-MM-DD`, UTC. */
  day: UtcDayKey;
  visitors: number;
}

/** UTC midnight of the day `now` falls in. */
function utcMidnight(now: Date): Date {
  return new Date(`${utcDayKey(now)}T00:00:00.000Z`);
}

/**
 * The `days` UTC day keys ending today, oldest first, as `[from, to]` midnights plus the keys.
 * Pure; exported for tests.
 */
export function dayWindow(days: number, now: Date): { from: Date; to: Date; keys: UtcDayKey[] } {
  const count = Math.max(1, Math.floor(days));
  const to = utcMidnight(now);
  const from = new Date(to.getTime() - (count - 1) * DAY_MS);
  const keys = Array.from({ length: count }, (_, index) =>
    utcDayKey(new Date(from.getTime() + index * DAY_MS)),
  );
  return { from, to, keys };
}

/** Zero-fills grouped day counts over `keys`. Pure; exported for tests. */
export function zeroFill(
  keys: readonly UtcDayKey[],
  rows: readonly { day: Date; visitors: number }[],
): DailyVisitors[] {
  const byDay = new Map(rows.map((row) => [utcDayKey(row.day), row.visitors]));
  return keys.map((day) => ({ day, visitors: byDay.get(day) ?? 0 }));
}

/** Average visitors a day, rounded; null when there were none. Pure; exported for tests. */
export function baselineFromCount(visitorDays: number, windowDays: number): number | null {
  if (visitorDays <= 0) return null;
  return Math.round(visitorDays / windowDays);
}

/**
 * Visitors per UTC day for the last `days` days including today, oldest first, zero-filled.
 * A visitor is a browser: one per day however many pages it viewed.
 */
export async function dailyVisitors(
  websiteId: string,
  days: number,
  now: Date = new Date(),
): Promise<DailyVisitors[]> {
  const window = dayWindow(days, now);
  const rows = await visitorDayRepo.countVisitorsByDay(websiteId, window.from, window.to);
  return zeroFill(window.keys, rows);
}

/**
 * Distinct visitors over the last 30 UTC days including today (D8): a browser that came back on
 * ten different days counts once — so this is less than the sum of `dailyVisitors(…, 30)`.
 */
export async function visitors30(websiteId: string, now: Date = new Date()): Promise<number> {
  const window = dayWindow(VISITOR_WINDOW_DAYS, now);
  return visitorDayRepo.countDistinctVisitors(websiteId, window.from, window.to);
}

/**
 * A page's traffic baseline: visitor-days on that exact (normalised) URL over the last 30 days
 * ÷ 30, rounded — "about N visitors a day". Null when the page has no hits in the window (render
 * `NO_TRAFFIC_ESTIMATE`) or the URL is not a usable http(s) URL.
 */
export async function pageBaseline(
  websiteId: string,
  url: string,
  now: Date = new Date(),
): Promise<number | null> {
  const urlKey = normalizeUrl(url);
  if (!urlKey) return null;

  const window = dayWindow(VISITOR_WINDOW_DAYS, now);
  const count = await pageVisitorDayRepo.countPageVisitorDays(
    websiteId,
    urlKey,
    window.from,
    window.to,
  );
  return baselineFromCount(count, VISITOR_WINDOW_DAYS);
}
