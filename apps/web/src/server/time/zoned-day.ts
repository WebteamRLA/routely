/**
 * Calendar days in a project's time zone.
 *
 * Reporting days are the project's own (`Website.timezone`, an IANA zone): a visitor at 23:30
 * in New York belongs to that New York day, not to the next UTC one. Pure and dependency-free —
 * the runtime's `Intl` time-zone database does the conversion — so it is unit-testable.
 *
 * Day keys are `YYYY-MM-DD` strings. Arithmetic on keys is done in UTC on the key itself (a key
 * names a calendar date, not an instant), which keeps it immune to DST: adding one day to
 * `2026-03-08` is `2026-03-09` whatever the clocks did that night.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      // An unknown zone (never stored — validated on write — but tolerate legacy rows).
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar day `at` falls on in `timeZone`, as `YYYY-MM-DD`. */
export function dayKeyInZone(at: Date, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `day` plus `delta` calendar days. */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Every day from `from` to `to` inclusive, oldest first. Empty when `from` is after `to`. */
export function daysBetween(from: string, to: string, maxDays = 3660): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < maxDays) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/**
 * The instant a project-local day starts, as a UTC `Date`. Used to bound queries: rows at or
 * after `startOfDayInZone(first)` and before `startOfDayInZone(addDays(last, 1))` are exactly
 * the rows whose local day is in `[first, last]`.
 *
 * Found by correcting a UTC-midnight guess by the zone's offset at that instant, then once more
 * in case the offset differs either side of a DST change.
 */
export function startOfDayInZone(day: string, timeZone: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  let guess = utcMidnight - offsetMs(new Date(utcMidnight), timeZone);
  guess = utcMidnight - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** The zone's offset from UTC at `at`, in milliseconds (positive east of Greenwich). */
function offsetMs(at: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
  } catch {
    return 0;
  }
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
