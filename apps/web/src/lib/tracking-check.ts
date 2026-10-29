/**
 * The verdict of one tracking check, as a pure function of what was observed. Shared by
 * `tracking-check.service` and its tests.
 *
 *  - **OK, method "html"** — the page loaded and its HTML carries this website's site id.
 *  - **OK, method "seen"** — the snippet was not in the fetched HTML (a tag manager or consent
 *    banner injects it later), or the page could not be fetched from the server (bot protection,
 *    a login wall), but real browsers reported hits on this exact URL within the last 7 days. A
 *    hit can only come from the snippet running on that page, so it is stronger evidence than the
 *    HTML anyway.
 *  - **MISSING** — the page loaded, the snippet is not in it, and no recent hits.
 *  - **ERROR** — the page could not be loaded (network error, timeout, HTTP ≥ 400, or a URL the
 *    fetch refused) and no recent hits.
 */

export type TrackingCheckVerdict = "OK" | "MISSING" | "ERROR";
export type TrackingCheckMethod = "html" | "seen";

/** How recent a hit on the URL must be for the "seen" fallback. */
export const SEEN_FALLBACK_DAYS = 7;

/** How long an OK check stays good enough for launch without being re-run. */
export const TRACKING_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TrackingObservation {
  pageLoaded: boolean;
  scriptFound: boolean;
  /** Hits on this URL within `SEEN_FALLBACK_DAYS`. */
  seenRecently: boolean;
  /** Why the page did not load, when it did not. */
  loadError: string | null;
  wrongSiteId: boolean;
  /** The other projects' ids found on the page, to name in the message. */
  otherSiteIds?: string[];
  /** The code was found only past the page cache (`pixel.service.inspectPage`). */
  staleCache?: boolean;
}

/** Shown on an OK check whose page is still cached without the code. */
export const STALE_CACHE_DETAIL =
  "The code is on your site, but your server’s cache is still showing visitors an older copy of this page. Visitors get the code when the cache refreshes; clear your server cache to make it immediate.";

export function decideTrackingCheck(observation: TrackingObservation): {
  result: TrackingCheckVerdict;
  method: TrackingCheckMethod | null;
  detail: string | null;
} {
  if (observation.pageLoaded && observation.scriptFound) {
    return {
      result: "OK",
      method: "html",
      detail: observation.staleCache ? STALE_CACHE_DETAIL : null,
    };
  }
  if (observation.seenRecently) {
    return {
      result: "OK",
      method: "seen",
      detail: observation.pageLoaded
        ? "The code isn't in the page's HTML, but this page reported visits in the last 7 days."
        : "We couldn't load the page, but it reported visits in the last 7 days.",
    };
  }
  if (!observation.pageLoaded) {
    return {
      result: "ERROR",
      method: null,
      detail: observation.loadError ?? "The page didn't load.",
    };
  }
  return {
    result: "MISSING",
    method: null,
    detail: observation.wrongSiteId
      ? wrongProjectDetail(observation.otherSiteIds ?? [])
      : "The page loaded, but the Routely code isn't on it.",
  };
}

/**
 * Names the Project ID the page carries: after a snippet is replaced, a caching plugin or CDN
 * often keeps serving the old page, and the ID is how a customer tells the two cases apart.
 */
export function wrongProjectDetail(found: readonly string[]): string {
  const ids = found.slice(0, 2).join(" and ");
  return (
    "This page has the Routely snippet for a different project" +
    (ids ? " (Project ID " + ids + ")" : "") +
    ". Replace it with this project’s snippet. If you already did, a caching plugin or CDN may" +
    " still be serving the old page: clear its cache and check again."
  );
}

/** True when a stored check is OK and recent enough to stand in for a fresh one. */
export function isFreshOk(
  check: { result: string; checkedAt: Date } | undefined,
  now: Date,
  maxAgeMs: number = TRACKING_CHECK_MAX_AGE_MS,
): boolean {
  return (
    check !== undefined &&
    check.result === "OK" &&
    now.getTime() - check.checkedAt.getTime() <= maxAgeMs
  );
}
