/**
 * UTC calendar days.
 *
 * The daily Sheets sync has to answer "which day is this row about?", and a day is not a
 * quantity of time — it is a label with a timezone behind it. Everything here is UTC, for two
 * reasons worth stating once rather than rediscovering:
 *
 * - `lib/format.ts` already pins every rendered date to `timeZone: "UTC"`, so the dashboard and
 *   the spreadsheet agree by construction.
 * - A per-customer timezone would need the aggregation boundary, the cron trigger hour and the
 *   spreadsheet's own `properties.timeZone` to agree with each other. That is a different
 *   feature; see `docs/INTEGRATIONS.md` for why it is not this one.
 *
 * Kept separate from `lib/date-range.ts` on purpose: those are *rolling* windows anchored on
 * now ("the last 24 hours"), which is the right shape for a dashboard filter and the wrong shape
 * for a row that claims to describe 28 September.
 */

import type { DateRange } from "@/validation/common";

/** `YYYY-MM-DD`. Narrower than `string` only by convention — validated by `dayKeySchema`. */
export type UtcDayKey = string;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Matches `YYYY-MM-DD`. Shape only; `isUtcDayKey` also checks the date is real. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The UTC calendar day an instant falls in, as `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` would do the same thing, and is what this used to be. It is
 * spelled out instead because the slice silently depends on the ISO string's exact width, and
 * a `Date` far enough out of range renders as `±YYYYYY-MM-DD` — six digits and a sign — which
 * slices to garbage rather than throwing.
 */
export function utcDayKey(instant: Date): UtcDayKey {
  const year = instant.getUTCFullYear();

  if (!Number.isFinite(year) || year < 0 || year > 9999) {
    throw new RangeError(`Cannot express ${instant.toISOString()} as a YYYY-MM-DD day key`);
  }

  const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const day = String(instant.getUTCDate()).padStart(2, "0");

  return `${String(year).padStart(4, "0")}-${month}-${day}`;
}

/** True when `value` is a well-formed `YYYY-MM-DD` naming a date that exists. */
export function isUtcDayKey(value: unknown): value is UtcDayKey {
  if (typeof value !== "string" || !DAY_KEY_PATTERN.test(value)) return false;

  // `2026-02-30` matches the pattern. Round-tripping through Date is what rejects it: the
  // parse rolls it forward to 2 March, so the re-rendered key no longer matches the input.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && utcDayKey(parsed) === value;
}

/**
 * The UTC day before the one `now` falls in.
 *
 * This is what the daily sweep syncs. Subtracting 24 hours from `now` would be wrong on its own
 * — it lands at the same *time* yesterday, not at yesterday — so the instant is first collapsed
 * to midnight and then stepped back a day. Because both ends are UTC there is no daylight-saving
 * hazard, which is precisely why this module does not use local time.
 */
export function previousUtcDay(now: Date = new Date()): UtcDayKey {
  const midnight = Date.parse(`${utcDayKey(now)}T00:00:00.000Z`);
  return utcDayKey(new Date(midnight - DAY_MS));
}

/**
 * The inclusive instant range covering one UTC day.
 *
 * Inclusive at both ends — `.999Z`, not the next midnight — because every date filter in this
 * codebase is `{ gte, lte }`. An exclusive end here would read the same and quietly disagree
 * with what the dashboard shows for the same window, which is the one thing this sync must not
 * do: the spreadsheet is checked *against* the dashboard.
 *
 * The lost millisecond is real and irrelevant: timestamps are stored to millisecond precision,
 * so `23:59:59.999` is the last representable instant of the day.
 */
export function utcDayRange(day: UtcDayKey): DateRange {
  if (!isUtcDayKey(day)) {
    throw new RangeError(`Not a UTC day key: ${JSON.stringify(day)}`);
  }

  return {
    from: new Date(`${day}T00:00:00.000Z`),
    to: new Date(`${day}T23:59:59.999Z`),
  };
}

/**
 * The `count` UTC days ending with `day`, oldest first.
 *
 * Used to retry days whose write definitely failed. Returns `day` alone for `count <= 1`.
 */
export function utcDaysEndingWith(day: UtcDayKey, count: number): UtcDayKey[] {
  const end = Date.parse(`${utcDayRange(day).from.toISOString()}`);
  const total = Math.max(1, Math.floor(count));

  return Array.from({ length: total }, (_, index) =>
    utcDayKey(new Date(end - (total - 1 - index) * DAY_MS)),
  );
}
