import { describe, expect, it } from "vitest";

import {
  capitalize,
  dayNumber,
  formatClockTime,
  formatDateAtTime,
  formatDays,
  formatMonthDay,
  formatMonthDayYear,
  formatRunRange,
  isJustNow,
  ranDays,
  relativeTime,
} from "@/lib/experiment-time";

const at = (iso: string) => new Date(iso);

describe("dayNumber", () => {
  it("is day 1 for the first 24 hours, then counts calendar time", () => {
    const launched = at("2026-10-01T08:00:00Z");
    expect(dayNumber(launched, at("2026-10-01T08:00:00Z"))).toBe(1);
    expect(dayNumber(launched, at("2026-10-02T07:59:59Z"))).toBe(1);
    expect(dayNumber(launched, at("2026-10-02T08:00:00Z"))).toBe(2);
    expect(dayNumber(launched, at("2026-10-21T09:00:00Z"))).toBe(21);
  });

  it("never drops below 1 on clock skew", () => {
    expect(dayNumber(at("2026-10-01T08:00:05Z"), at("2026-10-01T08:00:00Z"))).toBe(1);
  });
});

describe("ranDays", () => {
  it("counts inclusive UTC calendar days", () => {
    expect(ranDays(at("2026-09-02T10:00:00Z"), at("2026-09-30T18:00:00Z"))).toBe(29);
    expect(ranDays(at("2026-08-20T23:00:00Z"), at("2026-09-18T01:00:00Z"))).toBe(30);
    expect(ranDays(at("2026-10-01T08:00:00Z"), at("2026-10-01T20:00:00Z"))).toBe(1);
  });

  it("crosses a month and a year end", () => {
    expect(ranDays(at("2026-12-30T00:00:00Z"), at("2027-01-02T00:00:00Z"))).toBe(4);
  });

  it("pluralises days", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(9)).toBe("9 days");
  });
});

describe("relativeTime", () => {
  const now = at("2026-10-19T12:00:00Z");

  it("short style for tracking badges", () => {
    expect(relativeTime(at("2026-10-19T11:59:30Z"), now)).toBe("just now");
    expect(relativeTime(at("2026-10-19T11:56:00Z"), now)).toBe("4 min ago");
    expect(relativeTime(at("2026-10-19T09:00:00Z"), now)).toBe("3 h ago");
    expect(relativeTime(at("2026-09-24T12:00:00Z"), now)).toBe("25 d ago");
  });

  it("long style for review checks and sessions", () => {
    expect(relativeTime(at("2026-10-19T11:59:00Z"), now, "long")).toBe("1 minute ago");
    expect(relativeTime(at("2026-10-19T11:56:00Z"), now, "long")).toBe("4 minutes ago");
    expect(relativeTime(at("2026-10-19T10:00:00Z"), now, "long")).toBe("2 hours ago");
    expect(relativeTime(at("2026-10-18T12:00:00Z"), now, "long")).toBe("1 day ago");
    expect(relativeTime(at("2026-09-24T12:00:00Z"), now, "long")).toBe("25 days ago");
  });

  it("treats future timestamps as just now", () => {
    expect(relativeTime(at("2026-10-19T12:05:00Z"), now)).toBe("just now");
  });

  it("isJustNow and capitalize give the activity log's 'Just now'", () => {
    expect(isJustNow(at("2026-10-19T11:59:01Z"), now)).toBe(true);
    expect(isJustNow(at("2026-10-19T11:59:00Z"), now)).toBe(false);
    expect(capitalize(relativeTime(now, now))).toBe("Just now");
  });
});

describe("calendar labels", () => {
  const instant = at("2026-10-13T08:05:00Z");

  it("render the design's US-style formats in UTC by default", () => {
    expect(formatMonthDay(instant)).toBe("Oct 13");
    expect(formatMonthDayYear(instant)).toBe("Oct 13, 2026");
    expect(formatClockTime(instant)).toBe("8:05 AM");
    expect(formatDateAtTime(instant)).toBe("Oct 13, 2026 at 8:05 AM");
    expect(formatRunRange(at("2026-09-02T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe(
      "Sep 2 – Sep 30",
    );
  });

  it("accept a viewer time zone", () => {
    expect(formatDateAtTime(at("2026-10-13T02:00:00Z"), "America/New_York")).toBe(
      "Oct 12, 2026 at 10:00 PM",
    );
  });
});
