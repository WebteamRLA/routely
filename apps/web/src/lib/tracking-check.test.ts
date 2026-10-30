import { describe, expect, it } from "vitest";

import {
  TRACKING_CHECK_MAX_AGE_MS,
  decideTrackingCheck,
  isFreshOk,
  STALE_CACHE_DETAIL,
} from "./tracking-check";

const base = {
  pageLoaded: true,
  scriptFound: false,
  seenRecently: false,
  loadError: null,
  wrongSiteId: false,
};

describe("decideTrackingCheck", () => {
  it("is OK by html when the snippet is in the page", () => {
    expect(decideTrackingCheck({ ...base, scriptFound: true })).toEqual({
      result: "OK",
      method: "html",
      detail: null,
    });
  });

  it("falls back to OK by 'seen' when the page reported hits recently", () => {
    expect(decideTrackingCheck({ ...base, seenRecently: true })).toMatchObject({
      result: "OK",
      method: "seen",
    });
  });

  it("uses 'seen' even when the server could not load the page", () => {
    expect(
      decideTrackingCheck({
        ...base,
        pageLoaded: false,
        loadError: "HTTP 403",
        seenRecently: true,
      }),
    ).toMatchObject({ result: "OK", method: "seen" });
  });

  it("is MISSING when the page loaded without the snippet", () => {
    expect(decideTrackingCheck(base)).toMatchObject({ result: "MISSING", method: null });
    expect(decideTrackingCheck({ ...base, wrongSiteId: true }).detail).toMatch(/different project/);
    expect(
      decideTrackingCheck({ ...base, wrongSiteId: true, otherSiteIds: ["rt_old1", "rt_old2"] })
        .detail,
    ).toMatch(/Project ID rt_old1 and rt_old2.*cached copy.*Clear your website and server cache/);
  });

  it("says to replace a mismatched snippet seen fresh from the site, without blaming a cache", () => {
    const detail = decideTrackingCheck({
      ...base,
      wrongSiteId: true,
      otherSiteIds: ["rt_old1"],
      mismatchConfirmed: true,
    }).detail;
    expect(detail).toMatch(/Project ID rt_old1\)\. Replace it/);
    expect(detail).not.toMatch(/cache/i);
  });

  it("is OK when the code is found past a stale cache, and says so; notes a delayed snippet", () => {
    expect(decideTrackingCheck({ ...base, scriptFound: true, staleCache: true })).toEqual({
      result: "OK",
      method: "html",
      detail: STALE_CACHE_DETAIL,
    });
    expect(
      decideTrackingCheck({ ...base, scriptFound: true, delayedBy: "LiteSpeed Cache" }).detail,
    ).toMatch(/^LiteSpeed Cache delays the Routely code/);
  });

  it("is ERROR when the page did not load and nothing was seen", () => {
    expect(
      decideTrackingCheck({ ...base, pageLoaded: false, loadError: "returned HTTP 500." }),
    ).toEqual({ result: "ERROR", method: null, detail: "returned HTTP 500." });
  });
});

describe("isFreshOk", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  it("accepts an OK check within 24 hours", () => {
    expect(isFreshOk({ result: "OK", checkedAt: new Date(now.getTime() - 1000) }, now)).toBe(true);
    expect(
      isFreshOk(
        { result: "OK", checkedAt: new Date(now.getTime() - TRACKING_CHECK_MAX_AGE_MS) },
        now,
      ),
    ).toBe(true);
  });

  it("rejects stale, failed or missing checks", () => {
    const stale = new Date(now.getTime() - TRACKING_CHECK_MAX_AGE_MS - 1);
    expect(isFreshOk({ result: "OK", checkedAt: stale }, now)).toBe(false);
    expect(isFreshOk({ result: "MISSING", checkedAt: now }, now)).toBe(false);
    expect(isFreshOk(undefined, now)).toBe(false);
  });
});
