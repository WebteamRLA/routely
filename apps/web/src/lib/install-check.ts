/**
 * Decides an install check from what was fetched — pure, shared by the tracking dialog's Verify
 * (`pixel.service.verifyInstallation`) and the launch's tracking checks
 * (`tracking-check.service`).
 *
 * A check looks at the page twice when it has to. First as visitors get it ("served"). When this
 * project's ID isn't there, once more with a query string no cache has seen
 * (`withCacheBuster`), which host page caches (xCloud's Nginx, Varnish, LiteSpeed) pass straight
 * to WordPress ("fresh"). The two copies are what tell the failure reasons apart:
 *
 *  - this project's ID on the served copy → installed;
 *  - only on the fresh copy → installed, and a server cache is still showing visitors an older
 *    copy (seen on xCloud 2026-10-29: `x-cache: HIT` served an old snippet for hours, though
 *    WordPress said `no-store`). Counted as installed: the code on the site is this project's;
 *  - another project's ID on a fresh copy that no cache answered → a genuine mismatch: the
 *    site's code belongs to another project. Never counted as installed;
 *  - another project's ID, but every copy came from a cache → can't tell yet: clear the caches;
 *  - no Routely ID at all → not installed.
 */

import type { SnippetDetection } from "@/lib/snippet-detect";

/** The query parameter a fresh look adds. Any unseen query string bypasses a page cache. */
export const CACHE_BUSTER_PARAM = "_routely_check";

export function withCacheBuster(url: string, now: number = Date.now()): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(CACHE_BUSTER_PARAM, String(now));
    return parsed.href;
  } catch {
    return url;
  }
}

export type CacheState = "hit" | "miss" | "unknown";

/**
 * Whether a cache answered, from the response's cache headers (lower-cased names). `HIT`,
 * `STALE` and friends in any of them → hit; an explicit `MISS`/`BYPASS`/`DYNAMIC`/`EXPIRED` →
 * miss; nothing recognisable → unknown. An `age` above zero with no other header is a hit.
 */
export function cacheState(headers: Record<string, string>): CacheState {
  let miss = false;
  for (const [name, raw] of Object.entries(headers)) {
    if (name === "age") continue;
    const value = raw.toLowerCase();
    if (/\b(hit|stale|revalidated|updating)\b/.test(value)) return "hit";
    if (/\b(miss|bypass|dynamic|expired|pass|none)\b/.test(value)) miss = true;
  }
  if (miss) return "miss";
  const age = Number.parseInt(headers["age"] ?? "", 10);
  return Number.isFinite(age) && age > 0 ? "hit" : "unknown";
}

/** One look at the page. */
export interface PageLook {
  loaded: boolean;
  detection: SnippetDetection;
  cache: CacheState;
}

export interface InstallFinding {
  /** This project's code is on the site (on the served copy, or on the fresh one). */
  scriptFound: boolean;
  /** Found only on the fresh copy: visitors still get an older cached page. */
  staleCache: boolean;
  /** Another project's ID, and not this one's. */
  wrongSiteId: boolean;
  /** …seen on a copy no cache answered, so it is the site's real code, not a stale copy. */
  mismatchConfirmed: boolean;
  otherSiteIds: string[];
  /** This project's code and another project's are both on the page. */
  alsoOtherProject: boolean;
  /** The optional anti-flicker block is on the page (reported apart from the tracking code). */
  antiFlickerFound: boolean;
  /** What delays the Routely code, if anything (`SnippetDetection.delayedBy`). */
  delayedBy: string | null;
}

/**
 * The verdict from the served copy and, when one was taken, the fresh copy. `fresh` is null when
 * no second look was needed (or possible); a fresh copy that failed to load is ignored.
 */
export function combineLooks(served: PageLook, fresh: PageLook | null): InstallFinding {
  const freshLoaded = fresh?.loaded ? fresh : null;
  if (served.loaded && served.detection.scriptFound) return found(served, false);
  if (freshLoaded?.detection.scriptFound) return found(freshLoaded, true);

  // Not installed: judge by the copy closest to WordPress.
  const base = freshLoaded ?? served;
  const d = base.detection;
  const uncached = base === freshLoaded ? base.cache !== "hit" : base.cache === "miss";
  return {
    scriptFound: false,
    staleCache: false,
    wrongSiteId: d.wrongSiteId,
    mismatchConfirmed: d.wrongSiteId && uncached,
    otherSiteIds: d.otherSiteIds,
    alsoOtherProject: false,
    antiFlickerFound: d.antiFlickerFound,
    delayedBy: null,
  };
}

function found(look: PageLook, staleCache: boolean): InstallFinding {
  const d = look.detection;
  return {
    scriptFound: true,
    staleCache,
    wrongSiteId: false,
    mismatchConfirmed: false,
    otherSiteIds: d.otherSiteIds,
    alsoOtherProject: d.otherSiteIds.length > 0,
    antiFlickerFound: d.antiFlickerFound,
    delayedBy: d.delayedBy,
  };
}
