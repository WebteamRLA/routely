import type { PageHit } from "./contract";
import { SDK_PROTOCOL_VERSION } from "./contract";
import { type KeyValueStore, getLocalStorage } from "./env";
import { post } from "./track";
import { normalizeUrl } from "./url";

/**
 * The site-wide page hit.
 *
 * Every other report is about an experiment. This one is about the website: it says "this
 * browser saw this page today", on every page carrying the snippet, whether or not anything is
 * being tested there. It is what lets the dashboard show that tracking is live, count visitors
 * per day, and estimate a page's traffic before a test is launched on it.
 *
 * At most one per normalised URL per UTC day per browser. The server stores the hit as a
 * `(website, day, visitor)` row with `ON CONFLICT DO NOTHING`, so the dedupe here only saves
 * requests — it is not what makes the counts correct, and losing it (no storage) costs traffic,
 * not accuracy.
 *
 * Sent before the configuration is fetched and independently of it: a site with no running
 * experiment, or an API that cannot answer, still reports that the snippet is installed.
 */

const KEY = "routely_hits";

/** URLs remembered per day. A crawl through a large catalogue stops being deduped beyond it,
 * which the server's conflict handling absorbs. */
const MAX_URLS = 200;

interface HitLog {
  /** UTC day, `YYYY-MM-DD`. */
  d: string;
  /** Hashes of the URLs already reported that day. */
  u: string[];
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** A short, non-cryptographic hash, so the log holds ids rather than whole URLs. */
export function hashUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * Returns true when `url` has not been reported today **for this site id**, and records that it
 * now has. A log from a previous day is discarded, so the stored value never grows past one day.
 *
 * Keyed by site and URL together: keyed by URL alone, a page reported for one project silenced
 * the same page for the rest of the day after the snippet was swapped for another project's
 * (a re-created project gets a new id), so the new project never saw a hit.
 */
export function claimHit(
  siteId: string,
  url: string,
  store: KeyValueStore | null,
  now: number,
): boolean {
  if (!store) return true;

  const day = utcDay(now);
  const id = hashUrl(siteId + " " + url);

  try {
    let log: HitLog | null = null;
    try {
      log = JSON.parse(store.getItem(KEY) || "null") as HitLog | null;
    } catch {
      // Anything unreadable is treated as no log, and overwritten.
    }

    const seen = log && log.d === day && Array.isArray(log.u) ? log.u : [];
    if (seen.indexOf(id) >= 0) return false;

    if (seen.length < MAX_URLS) {
      seen.push(id);
      store.setItem(KEY, JSON.stringify({ d: day, u: seen }));
    }
  } catch {
    // Storage that fails mid-way means sending; the server dedupes.
  }

  return true;
}

/**
 * Reports a page hit if this URL has not been reported today. Returns whether one was sent.
 * Never throws.
 */
export function sendHit(
  apiBase: string,
  siteId: string,
  anonymousId: string,
  href: string,
  store: KeyValueStore | null = getLocalStorage(),
  now: number = Date.now(),
): boolean {
  const url = normalizeUrl(href);
  if (!url || !claimHit(siteId, url, store, now)) return false;

  const hit: PageHit = { v: SDK_PROTOCOL_VERSION, siteId, anonymousId, url, ts: now };
  return post(apiBase + "/api/v1/hit", hit);
}
