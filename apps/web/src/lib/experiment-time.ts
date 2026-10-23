/**
 * Experiment timing and the short relative / calendar labels the designed screens render.
 *
 * `lib/format.ts` keeps its en-GB, UTC formats ("28 Aug 2026") for the pre-design pages. The new
 * design writes dates US-style ("Sep 22", "Sep 19, 2026", "Oct 13, 2026 at 8:05 AM"), so those
 * live here. Day arithmetic is UTC, like every other day in this codebase (`lib/utc-day.ts`);
 * the label formatters take a `timeZone` so a caller that knows the viewer's zone can pass it,
 * and default to UTC so server and client markup agree.
 */

import { utcDayKey } from "@/lib/utc-day";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Below this age a timestamp reads "just now". */
export const JUST_NOW_MS = MINUTE_MS;

/**
 * "Day N" / "· day N" for a running or paused experiment: `floor((now − publishedAt) / 1 day) + 1`.
 * Day 1 is the first 24 hours. Paused time counts — the clock is calendar time since launch.
 * Never below 1, so a clock skew that puts `publishedAt` slightly in the future still reads day 1.
 */
export function dayNumber(publishedAt: Date, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - publishedAt.getTime()) / DAY_MS) + 1);
}

/**
 * Inclusive UTC calendar days from launch to end: Sep 2 → Sep 30 is 29 days; launched and ended
 * the same day is 1. Used by "Ran Sep 2 – Sep 30 (29 days)" and "Ended … after N days".
 */
export function ranDays(publishedAt: Date, endedAt: Date): number {
  const start = Date.parse(`${utcDayKey(publishedAt)}T00:00:00.000Z`);
  const end = Date.parse(`${utcDayKey(endedAt)}T00:00:00.000Z`);
  return Math.max(1, Math.round((end - start) / DAY_MS) + 1);
}

/** "1 day" / "9 days". */
export function formatDays(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * How long ago `then` was, relative to `now`.
 *
 * - `short` (tracking badges): "just now", "4 min ago", "3 h ago", "25 d ago"
 * - `long` (review checks, sessions): "just now", "1 minute ago", "4 minutes ago", "2 hours ago",
 *   "25 days ago"
 *
 * Anything under a minute — or in the future, from clock skew — is "just now". Use
 * `capitalize()` for the activity log's "Just now".
 */
export function relativeTime(then: Date, now: Date, style: "short" | "long" = "short"): string {
  const age = now.getTime() - then.getTime();
  if (age < JUST_NOW_MS) return "just now";

  const unit = (n: number, short: string, one: string, many: string) =>
    style === "short" ? `${n} ${short} ago` : `${n} ${n === 1 ? one : many} ago`;

  if (age < HOUR_MS) return unit(Math.floor(age / MINUTE_MS), "min", "minute", "minutes");
  if (age < DAY_MS) return unit(Math.floor(age / HOUR_MS), "h", "hour", "hours");
  return unit(Math.floor(age / DAY_MS), "d", "day", "days");
}

/** True when `then` is under a minute before `now` ("Launched just now", "Just now"). */
export function isJustNow(then: Date, now: Date): boolean {
  return now.getTime() - then.getTime() < JUST_NOW_MS;
}

/** First letter upper-cased: "just now" → "Just now". */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
    formatters.set(key, f);
  }
  return f;
}

/** "Sep 22" */
export function formatMonthDay(value: Date, timeZone = "UTC"): string {
  return formatter(timeZone, { month: "short", day: "numeric" }).format(value);
}

/** "Sep 19, 2026" */
export function formatMonthDayYear(value: Date, timeZone = "UTC"): string {
  return formatter(timeZone, { month: "short", day: "numeric", year: "numeric" }).format(value);
}

/** "8:05 AM" */
export function formatClockTime(value: Date, timeZone = "UTC"): string {
  return formatter(timeZone, { hour: "numeric", minute: "2-digit", hour12: true }).format(value);
}

/** "Oct 13, 2026 at 8:05 AM" — the activity log's timestamp. */
export function formatDateAtTime(value: Date, timeZone = "UTC"): string {
  return `${formatMonthDayYear(value, timeZone)} at ${formatClockTime(value, timeZone)}`;
}

/** "Sep 2 – Sep 30" (U+2013 with spaces), as in "Ran Sep 2 – Sep 30 (29 days)". */
export function formatRunRange(publishedAt: Date, endedAt: Date, timeZone = "UTC"): string {
  return `${formatMonthDay(publishedAt, timeZone)} – ${formatMonthDay(endedAt, timeZone)}`;
}
