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
  /** Found only past the page cache (`lib/install-check.ts`). */
  staleCache?: boolean;
  /** The other project's ID was on a copy no cache answered: a real mismatch, not a stale page. */
  mismatchConfirmed?: boolean;
  /** What delays the Routely code, if anything. */
  delayedBy?: string | null;
}

/** On an OK check whose page a server cache still serves without the code. */
export const STALE_CACHE_DETAIL =
  "This project’s code is on your site, but your server’s cache is still showing visitors an older copy of this page. Visitors get the code when the cache refreshes; clear your server cache to update it now.";

/** On an OK check whose Routely code an optimiser or consent tool runs late. */
export function delayedDetail(by: string): string {
  return `${by} delays the Routely code, so visitors may see this page before a redirect. Exclude “routely” from its delayed or deferred JavaScript.`;
}

export function decideTrackingCheck(observation: TrackingObservation): {
  result: TrackingCheckVerdict;
  method: TrackingCheckMethod | null;
  detail: string | null;
} {
  if (observation.pageLoaded && observation.scriptFound) {
    return {
      result: "OK",
      method: "html",
      detail: observation.staleCache
        ? STALE_CACHE_DETAIL
        : observation.delayedBy
          ? delayedDetail(observation.delayedBy)
          : null,
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
      ? wrongProjectDetail(observation.otherSiteIds ?? [], observation.mismatchConfirmed ?? false)
      : "The page loaded, but the Routely code isn't on it.",
  };
}

/**
 * Names the Project ID the page carries. `confirmed`: it was on a copy no cache answered, so the
 * site's code really is another project's — say to replace it, and nothing about caches. Not
 * confirmed: every copy came from a cache, so it may be an old page — clear the caches first.
 */
export function wrongProjectDetail(found: readonly string[], confirmed = false): string {
  const ids = found.slice(0, 2).join(" and ");
  const named = ids ? " (Project ID " + ids + ")" : "";
  return confirmed
    ? "This page has the Routely snippet for a different project" +
        named +
        ". Replace it with this project’s snippet."
    : "This page shows the Routely snippet for a different project" +
        named +
        ", from a cached copy. Clear your website and server cache and check again; if it still shows, replace it with this project’s snippet.";
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
