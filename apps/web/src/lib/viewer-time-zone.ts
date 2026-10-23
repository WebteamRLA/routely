/**
 * The viewer's time zone, remembered in a cookie so server-rendered date labels ("Today",
 * "Sep 22", "Oct 13, 2026 at 8:05 AM") can be in the viewer's zone rather than UTC.
 *
 * The browser writes it (`useViewerTimeZone`) and the server reads it; until the first write, labels
 * render in UTC — the same default `lib/experiment-time.ts` uses — and the page refreshes once.
 * Day *arithmetic* (day N, chart buckets) stays UTC regardless; only labels move.
 */

export const VIEWER_TIME_ZONE_COOKIE = "rt_tz";
