import "server-only";

import type { Website } from "@/generated/prisma/client";
import { can } from "@/lib/permissions";
import {
  SEEN_FALLBACK_DAYS,
  TRACKING_CHECK_MAX_AGE_MS,
  type TrackingCheckMethod,
  type TrackingCheckVerdict,
  decideTrackingCheck,
  isFreshOk,
} from "@/lib/tracking-check";
import { isSameSite, normalizeUrl } from "@/lib/url";
import { utcDayKey } from "@/lib/utc-day";
import { forbidden, notFound } from "@/server/errors";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import type { ExperimentWithVariants } from "@/server/repositories/experiment.repository";
import * as pageVisitorDayRepo from "@/server/repositories/page-visitor-day.repository";
import * as trackingCheckRepo from "@/server/repositories/tracking-check.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { inspectPage } from "@/server/services/pixel.service";

/**
 * Tracking checks: is the snippet on each page an experiment depends on?
 *
 * Launch requires every relevant URL (A/B: the tested page and the goal; split URL: control,
 * every variant and the goal) to have an OK check from the last 24 hours, and the Review tab shows
 * the latest result per URL. A check fetches the page through `safe-fetch` (same-site on every
 * hop, public addresses only, ≤ 3 redirects, 5 s, 2 MB) and looks for the site id, falling back to
 * "seen" when the page itself reported hits in the last 7 days. See `lib/tracking-check.ts` for
 * the verdict rules.
 *
 * Every result is upserted into `TrackingCheck(websiteId, urlKey)`. The key is the server's
 * normalised URL, so editing a URL makes its old check irrelevant automatically.
 *
 * Authorization: reading stored checks needs membership; running a check (an outbound fetch on
 * the customer's behalf) needs `pixel.verify` (Editor and up). Non-members get NOT_FOUND.
 */

export interface UrlCheck {
  /** The URL as given. */
  url: string;
  /** Its normalised form — the `TrackingCheck` key. Null when the URL is not a usable http(s) URL. */
  urlKey: string | null;
  result: TrackingCheckVerdict;
  method: TrackingCheckMethod | null;
  pageLoaded: boolean;
  httpStatus: number | null;
  /** Customer-facing explanation for anything but an html OK; null otherwise. */
  detail: string | null;
  checkedAt: Date;
  /** True when this result came from a stored check rather than a fetch made now. */
  cached: boolean;
}

export interface CheckOptions {
  /** Reuse a stored OK check younger than this instead of fetching. Default: always fetch. */
  reuseOkWithinMs?: number;
  now?: Date;
}

/** The URLs a launch depends on, in display order, de-duplicated by normalised key. */
export function experimentTrackingUrls(experiment: ExperimentWithVariants): string[] {
  const candidates =
    experiment.type === "AB_TEST"
      ? [experiment.controlUrl, experiment.conversionUrl]
      : [
          experiment.controlUrl,
          ...experiment.variants.map((variant) => variant.url),
          experiment.conversionUrl,
        ];

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of candidates) {
    if (!url) continue;
    const key = normalizeUrl(url) ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

/** UTC midnight `days - 1` days before `now` — the start of an inclusive N-day window. */
function windowStart(now: Date, days: number): Date {
  const today = Date.parse(`${utcDayKey(now)}T00:00:00.000Z`);
  return new Date(today - (days - 1) * 24 * 60 * 60 * 1000);
}

/** Fetches and judges one URL, then stores the result. Never throws for a bad page. */
async function runCheck(website: Website, url: string, now: Date): Promise<UrlCheck> {
  const urlKey = normalizeUrl(url);

  if (!urlKey || !isSameSite(urlKey, website.domain)) {
    // Not stored: it is not a page of this website, so it has no business in its check table.
    return {
      url,
      urlKey,
      result: "ERROR",
      method: null,
      pageLoaded: false,
      httpStatus: null,
      detail: urlKey
        ? `${new URL(urlKey).hostname} is outside ${website.domain}.`
        : "Enter a full URL, including https://",
      checkedAt: now,
      cached: false,
    };
  }

  const [{ fetched, detection, staleCache }, seenRecently] = await Promise.all([
    inspectPage(url, website.domain, website.publicSiteId),
    pageVisitorDayRepo.pageSeenSince(website.id, urlKey, windowStart(now, SEEN_FALLBACK_DAYS)),
  ]);

  const verdict = decideTrackingCheck({
    pageLoaded: fetched.pageLoaded,
    scriptFound: detection.scriptFound,
    wrongSiteId: detection.wrongSiteId,
    otherSiteIds: detection.otherSiteIds,
    loadError: fetched.loadError,
    seenRecently,
    staleCache,
  });

  // The snippet found in the page is the same evidence the pixel dialog's Verify records, so the
  // project's tracking badge says Active from here on — a launch (which runs these checks) used to
  // leave a just-installed site reading "Not installed" until its first visitor. Only a find is
  // written: a failed check is not evidence that an earlier installation went away.
  if (detection.scriptFound) await websiteRepo.recordSnippetFound(website.id, now);

  await trackingCheckRepo.upsertTrackingCheck({
    websiteId: website.id,
    urlKey,
    result: verdict.result,
    method: verdict.method,
    pageLoaded: fetched.pageLoaded,
    httpStatus: fetched.httpStatus,
    detail: verdict.detail,
    checkedAt: now,
  });

  return {
    url,
    urlKey,
    ...verdict,
    pageLoaded: fetched.pageLoaded,
    httpStatus: fetched.httpStatus,
    checkedAt: now,
    cached: false,
  };
}

/**
 * Checks URLs of a website that the **caller has already authorized** (loaded through an
 * access-filtered query, with a role allowed to run checks). For services such as launch that
 * hold the website already; anything handling a request should use `checkUrls`.
 *
 * Runs in parallel; each fetch is bounded at 5 s, so the whole call is bounded at ~6 s.
 */
export async function checkUrlsForWebsite(
  website: Website,
  urls: readonly string[],
  options: CheckOptions = {},
): Promise<UrlCheck[]> {
  const now = options.now ?? new Date();

  const keys = urls.map((url) => normalizeUrl(url));
  const stored =
    options.reuseOkWithinMs === undefined
      ? []
      : await trackingCheckRepo.findTrackingChecks(
          website.id,
          keys.filter((key): key is string => key !== null),
        );
  const byKey = new Map(stored.map((check) => [check.urlKey, check]));

  return Promise.all(
    urls.map(async (url, index): Promise<UrlCheck> => {
      const key = keys[index] ?? null;
      const existing = key ? byKey.get(key) : undefined;
      if (
        existing &&
        options.reuseOkWithinMs !== undefined &&
        isFreshOk(existing, now, options.reuseOkWithinMs)
      ) {
        return {
          url,
          urlKey: key,
          result: existing.result,
          method: existing.method as TrackingCheckMethod | null,
          pageLoaded: existing.pageLoaded,
          httpStatus: existing.httpStatus,
          detail: existing.detail,
          checkedAt: existing.checkedAt,
          cached: true,
        };
      }
      return runCheck(website, url, now);
    }),
  );
}

/** Runs a fresh check of each URL on a website the actor can run checks on. */
export async function checkUrls(
  actorUserId: string,
  websiteId: string,
  urls: readonly string[],
  options: CheckOptions = {},
): Promise<UrlCheck[]> {
  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) throw notFound("That website does not exist.");
  if (!can(access.role, "pixel.verify")) throw forbidden();

  return checkUrlsForWebsite(access.website, urls.slice(0, 10), options);
}

export interface ExperimentTracking {
  checks: UrlCheck[];
  /** Every relevant URL has an OK check. */
  allOk: boolean;
}

/**
 * The launch tracking gate for one experiment: reuses each URL's OK check from the last 24 hours
 * and re-checks anything missing, failed or stale. Pass `force` to re-check everything (the
 * Review tab's "Check again").
 */
export async function checkExperimentTracking(
  actorUserId: string,
  experimentId: string,
  options: { force?: boolean; now?: Date } = {},
): Promise<ExperimentTracking> {
  const access = await experimentRepo.findExperimentAccess(experimentId, actorUserId);
  if (!access) throw notFound("That experiment does not exist.");
  if (!can(access.role, "pixel.verify")) throw forbidden();

  const { experiment } = access;
  const checks = await checkUrlsForWebsite(experiment.website, experimentTrackingUrls(experiment), {
    now: options.now,
    ...(options.force ? {} : { reuseOkWithinMs: TRACKING_CHECK_MAX_AGE_MS }),
  });

  return { checks, allOk: checks.length > 0 && checks.every((check) => check.result === "OK") };
}

/**
 * The stored checks for an experiment's URLs, without fetching anything — for read-only screens
 * (any member). A URL never checked has `check: null`.
 */
export async function getExperimentTracking(
  actorUserId: string,
  experimentId: string,
): Promise<
  {
    url: string;
    urlKey: string | null;
    check: Omit<UrlCheck, "url" | "urlKey" | "cached"> | null;
  }[]
> {
  const access = await experimentRepo.findExperimentAccess(experimentId, actorUserId);
  if (!access) throw notFound("That experiment does not exist.");

  const { experiment } = access;
  const urls = experimentTrackingUrls(experiment);
  const keys = urls.map((url) => normalizeUrl(url));
  const stored = await trackingCheckRepo.findTrackingChecks(
    experiment.websiteId,
    keys.filter((key): key is string => key !== null),
  );
  const byKey = new Map(stored.map((check) => [check.urlKey, check]));

  return urls.map((url, index) => {
    const key = keys[index] ?? null;
    const row = key ? byKey.get(key) : undefined;
    return {
      url,
      urlKey: key,
      check: row
        ? {
            result: row.result,
            method: row.method as TrackingCheckMethod | null,
            pageLoaded: row.pageLoaded,
            httpStatus: row.httpStatus,
            detail: row.detail,
            checkedAt: row.checkedAt,
          }
        : null,
    };
  });
}
