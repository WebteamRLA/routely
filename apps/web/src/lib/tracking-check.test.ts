import { describe, expect, it } from "vitest";

import { TRACKING_CHECK_MAX_AGE_MS, decideTrackingCheck, isFreshOk } from "./tracking-check";

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
    ).toMatch(/Project ID rt_old1 and rt_old2.*clear its cache/);
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
