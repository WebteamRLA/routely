/**
 * Display formatting helpers.
 *
 * Output never depends on the runtime's locale or time zone: these values are rendered on the
 * server and the client, and letting the format vary would produce a hydration mismatch.
 */

/**
 * A rate as a percentage, e.g. `0.0732` → "7.3%".
 *
 * One decimal place: the underlying counts are small enough at MVP volumes that a second
 * decimal would imply a precision the data does not have.
 */
export function formatPercent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * A duration in milliseconds as something readable: "0.8s", "24s", "1m 05s", "1h 02m".
 *
 * Rounded deliberately coarsely — this is an approximate measurement (see docs/SDK-DEPLOYMENT.md),
 * and rendering it to the millisecond would suggest otherwise.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";

  const seconds = ms / 1000;
  if (seconds < 1) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

// ---------------------------------------------------------------------------
// Prototype formatters (the design's `fN`, `fP`, `fS`, `fAgo`, `fDate`, `fDateY`).
//
// These are en-US, matching the design's copy ("Oct 8", "1,234").
// ---------------------------------------------------------------------------

const US_INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Whole number with grouping, e.g. `1234.6` → "1,235". */
export function fN(n: number): string {
  return US_INTEGER.format(Math.round(n));
}

/** Fraction as a percentage, e.g. `fP(0.0412, 2)` → "4.12%". */
export function fP(x: number, dp = 1): string {
  return `${(x * 100).toFixed(dp)}%`;
}

/**
 * Signed relative change, e.g. `0.12` → "+12.0%", `-0.034` → "−3.4%".
 * The minus is a true minus sign (U+2212), not a hyphen, as in the design.
 */
export function fS(x: number, dp = 1): string {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(dp)}%`;
}

/** Minutes elapsed as "Just now" / "12m ago" / "3h ago" / "4d ago". */
export function fAgo(minutes: number): string {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

/** Whole minutes between `then` and `now` (never negative), for feeding `fAgo`. */
export function minutesSince(then: Date | string | number, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(then).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

/**
 * `timeZone` defaults to UTC so server and client render the same text;
 * pass the project's reporting time zone where one is known.
 */
export function fDate(value: Date | string | number, timeZone = "UTC"): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
}

/** e.g. "Oct 8, 2026" */
export function fDateY(value: Date | string | number, timeZone = "UTC"): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}
