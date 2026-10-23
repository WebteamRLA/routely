import { describe, expect, it } from "vitest";

import {
  createKeyedThrottle,
  isResultReady,
  isTrackingAlertRearmable,
  retentionCutoff,
  trackingAlertDecision,
  trackingStoppedCutoff,
  VISITOR_DAY_RETENTION_DAYS,
  type TrackingAlertFacts,
} from "./notification-triggers";
import { TRACKING_ACTIVE_MS } from "./pixel-status";

const now = new Date("2026-10-19T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const arm = (name: string, visitors: number, conversions: number) => ({
  name,
  visitors,
  conversions,
});

describe("isResultReady", () => {
  const passing = [arm("Control", 1000, 100), arm("Variant A", 1200, 140)];

  it("is ready when every arm of an ACTIVE, unlatched experiment passes 1,000 / 100", () => {
    expect(isResultReady({ status: "ACTIVE", resultReadyAt: null, arms: passing })).toBe(true);
  });

  it("is not ready while any arm is short of visitors or conversions", () => {
    const shortVisitors = [arm("Control", 999, 120), arm("Variant A", 5000, 400)];
    const shortConversions = [arm("Control", 5000, 400), arm("Variant A", 5000, 99)];
    expect(isResultReady({ status: "ACTIVE", resultReadyAt: null, arms: shortVisitors })).toBe(
      false,
    );
    expect(isResultReady({ status: "ACTIVE", resultReadyAt: null, arms: shortConversions })).toBe(
      false,
    );
  });

  it("counts every variant, not just the leader", () => {
    const thirdShort = [
      arm("Control", 2000, 200),
      arm("Variant A", 2000, 260),
      arm("Variant B", 900, 150),
    ];
    expect(isResultReady({ status: "ACTIVE", resultReadyAt: null, arms: thirdShort })).toBe(false);
  });

  it("fires once: never after the latch is set", () => {
    expect(isResultReady({ status: "ACTIVE", resultReadyAt: ago(HOUR), arms: passing })).toBe(
      false,
    );
  });

  it("only for ACTIVE experiments", () => {
    for (const status of ["DRAFT", "PAUSED", "COMPLETED"] as const) {
      expect(isResultReady({ status, resultReadyAt: null, arms: passing })).toBe(false);
    }
  });

  it("needs at least one variant to compare against", () => {
    expect(
      isResultReady({ status: "ACTIVE", resultReadyAt: null, arms: [arm("Control", 5000, 500)] }),
    ).toBe(false);
  });

  it("does not care who is ahead — a flat result is still a result", () => {
    const flat = [arm("Control", 1000, 100), arm("Variant A", 1000, 100)];
    expect(isResultReady({ status: "ACTIVE", resultReadyAt: null, arms: flat })).toBe(true);
  });
});

describe("createKeyedThrottle", () => {
  it("lets a key through once per interval", () => {
    const throttle = createKeyedThrottle(60_000);
    expect(throttle.tryClaim("exp", 1_000)).toBe(true);
    expect(throttle.tryClaim("exp", 1_001)).toBe(false);
    expect(throttle.tryClaim("exp", 60_999)).toBe(false);
    expect(throttle.tryClaim("exp", 61_000)).toBe(true);
  });

  it("throttles keys independently", () => {
    const throttle = createKeyedThrottle(60_000);
    expect(throttle.tryClaim("a", 0)).toBe(true);
    expect(throttle.tryClaim("b", 0)).toBe(true);
    expect(throttle.tryClaim("a", 10)).toBe(false);
  });

  it("stays bounded: expired keys are evicted, and an overflow forgets everyone", () => {
    const throttle = createKeyedThrottle(1_000, 3);
    throttle.tryClaim("a", 0);
    throttle.tryClaim("b", 0);
    throttle.tryClaim("c", 500);
    // "a" and "b" expired at 1,000; making room for "d" evicts them and keeps "c".
    expect(throttle.tryClaim("d", 1_200)).toBe(true);
    expect(throttle.size).toBe(2);
    expect(throttle.tryClaim("c", 1_300)).toBe(false);

    throttle.tryClaim("e", 1_300);
    // Full with live keys: the map is cleared rather than grown.
    expect(throttle.tryClaim("f", 1_301)).toBe(true);
    expect(throttle.size).toBe(1);
    // Forgetting only ever allows an extra check — "c" may run early.
    expect(throttle.tryClaim("c", 1_302)).toBe(true);
  });
});

describe("trackingAlertDecision", () => {
  const facts = (overrides: Partial<TrackingAlertFacts>): TrackingAlertFacts => ({
    lastSeenAt: ago(25 * HOUR),
    pixelVerifiedAt: null,
    trackingAlertSentAt: null,
    activeExperiments: 1,
    ...overrides,
  });

  it("sends when a site that had hits has been quiet past 24 hours with an experiment running", () => {
    expect(trackingAlertDecision(facts({}), now)).toBe("send");
  });

  it("agrees with the badge at the threshold: exactly 24 hours is still Active", () => {
    expect(trackingAlertDecision(facts({ lastSeenAt: ago(TRACKING_ACTIVE_MS) }), now)).toBe(
      "still_active",
    );
    expect(trackingAlertDecision(facts({ lastSeenAt: ago(TRACKING_ACTIVE_MS + 1) }), now)).toBe(
      "send",
    );
  });

  it("holds back while a recent install check keeps the badge on Active", () => {
    expect(trackingAlertDecision(facts({ pixelVerifiedAt: ago(2 * HOUR) }), now)).toBe(
      "still_active",
    );
    expect(trackingAlertDecision(facts({ pixelVerifiedAt: ago(30 * HOUR) }), now)).toBe("send");
  });

  it("never fires for a site that never sent a hit", () => {
    expect(
      trackingAlertDecision(facts({ lastSeenAt: null, pixelVerifiedAt: ago(3 * DAY) }), now),
    ).toBe("never_seen");
  });

  it("only with an ACTIVE experiment", () => {
    expect(trackingAlertDecision(facts({ activeExperiments: 0 }), now)).toBe(
      "no_active_experiment",
    );
  });

  it("fires once per outage, and re-arms when a hit arrives after the alert", () => {
    const lastSeenAt = ago(3 * DAY);
    const alerted = facts({ lastSeenAt, trackingAlertSentAt: ago(2 * DAY) });
    expect(trackingAlertDecision(alerted, now)).toBe("already_alerted");
    expect(isTrackingAlertRearmable(alerted)).toBe(false);

    // Hits resumed after the alert, then stopped again for over a day.
    const resumed = facts({ lastSeenAt: ago(26 * HOUR), trackingAlertSentAt: ago(2 * DAY) });
    expect(isTrackingAlertRearmable(resumed)).toBe(true);
    expect(trackingAlertDecision(resumed, now)).toBe("send");
  });

  it("treats an alert at the same instant as the last hit as already sent", () => {
    const at = ago(2 * DAY);
    expect(trackingAlertDecision(facts({ lastSeenAt: at, trackingAlertSentAt: at }), now)).toBe(
      "already_alerted",
    );
  });

  it("has nothing to re-arm without an alert or a hit", () => {
    expect(isTrackingAlertRearmable({ lastSeenAt: ago(HOUR), trackingAlertSentAt: null })).toBe(
      false,
    );
    expect(isTrackingAlertRearmable({ lastSeenAt: null, trackingAlertSentAt: ago(HOUR) })).toBe(
      false,
    );
  });

  it("puts the SQL cutoff exactly at the badge's threshold", () => {
    expect(trackingStoppedCutoff(now).getTime()).toBe(now.getTime() - TRACKING_ACTIVE_MS);
  });
});

describe("retentionCutoff", () => {
  it("keeps the last 400 days: the day exactly 400 days ago survives, the one before goes", () => {
    expect(VISITOR_DAY_RETENTION_DAYS).toBe(400);
    const cutoff = retentionCutoff(now);
    expect(cutoff.toISOString()).toBe("2025-09-14T00:00:00.000Z");
    expect(Math.round((Date.parse("2026-10-19T00:00:00Z") - cutoff.getTime()) / DAY)).toBe(400);
  });

  it("is a UTC midnight whatever the time of day", () => {
    expect(retentionCutoff(new Date("2026-10-19T00:00:00.000Z")).toISOString()).toBe(
      "2025-09-14T00:00:00.000Z",
    );
    expect(retentionCutoff(new Date("2026-10-19T23:59:59.999Z")).toISOString()).toBe(
      "2025-09-14T00:00:00.000Z",
    );
  });
});
