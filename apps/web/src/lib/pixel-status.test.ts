import { describe, expect, it } from "vitest";

import { TRACKING_ACTIVE_MS, trackingStatus } from "./pixel-status";

const now = new Date("2026-10-19T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe("trackingStatus", () => {
  it("is Not installed when nothing has ever been seen", () => {
    expect(trackingStatus({ lastSeenAt: null, pixelVerifiedAt: null }, now)).toEqual({
      state: "not_installed",
      label: "Not installed",
      seenAt: null,
      when: null,
      since: null,
    });
  });

  it("is Active within 24 hours of a hit", () => {
    const status = trackingStatus({ lastSeenAt: ago(4 * MIN), pixelVerifiedAt: null }, now);
    expect(status.state).toBe("active");
    expect(status.label).toBe("Active");
    expect(status.when).toBe("4 min ago");
    expect(status.since).toBe("Oct 19, 2026");
  });

  it("treats exactly 24 hours as still Active and a moment later as Not seen", () => {
    expect(
      trackingStatus({ lastSeenAt: ago(TRACKING_ACTIVE_MS), pixelVerifiedAt: null }, now).state,
    ).toBe("active");
    expect(
      trackingStatus({ lastSeenAt: ago(TRACKING_ACTIVE_MS + 1), pixelVerifiedAt: null }, now).state,
    ).toBe("not_seen");
  });

  it("is Not seen when the last evidence is stale", () => {
    const status = trackingStatus({ lastSeenAt: ago(25 * DAY), pixelVerifiedAt: null }, now);
    expect(status).toMatchObject({
      state: "not_seen",
      label: "Not seen",
      when: "25 d ago",
      since: "Sep 24, 2026",
    });
  });

  it("counts a recent install check as evidence before the first hit", () => {
    const status = trackingStatus({ lastSeenAt: null, pixelVerifiedAt: ago(30 * 1000) }, now);
    expect(status.state).toBe("active");
    expect(status.when).toBe("just now");
  });

  it("uses the later of the two signals", () => {
    const verified = ago(2 * DAY);
    const seen = ago(3 * MIN);
    expect(trackingStatus({ lastSeenAt: seen, pixelVerifiedAt: verified }, now).seenAt).toBe(seen);
    expect(
      trackingStatus({ lastSeenAt: ago(40 * DAY), pixelVerifiedAt: ago(2 * 60 * MIN) }, now).state,
    ).toBe("active");
  });

  it("formats `since` in the requested time zone without changing the state", () => {
    const late = new Date("2026-10-19T02:00:00.000Z");
    const status = trackingStatus(
      { lastSeenAt: late, pixelVerifiedAt: null },
      now,
      "America/Los_Angeles",
    );
    expect(status.since).toBe("Oct 18, 2026");
    expect(status.state).toBe("active");
  });

  it("reads a future timestamp (clock skew) as just now", () => {
    const status = trackingStatus(
      { lastSeenAt: new Date(now.getTime() + MIN), pixelVerifiedAt: null },
      now,
    );
    expect(status.state).toBe("active");
    expect(status.when).toBe("just now");
  });
});
