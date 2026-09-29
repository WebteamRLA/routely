import { describe, expect, it } from "vitest";

import {
  isUtcDayKey,
  previousUtcDay,
  utcDayKey,
  utcDayRange,
  utcDaysEndingWith,
} from "@/lib/utc-day";

/**
 * A day boundary that is off by one writes the wrong numbers into a customer's spreadsheet and
 * looks like a reporting bug rather than an arithmetic one. These are the cases that go wrong.
 */
describe("utcDayKey", () => {
  it("names the UTC day an instant falls in", () => {
    expect(utcDayKey(new Date("2026-09-28T12:00:00.000Z"))).toBe("2026-09-28");
    expect(utcDayKey(new Date("2026-09-28T00:00:00.000Z"))).toBe("2026-09-28");
    expect(utcDayKey(new Date("2026-09-28T23:59:59.999Z"))).toBe("2026-09-28");
  });

  it("uses UTC, not the local timezone", () => {
    // 23:30 UTC is already the next day in UTC+13 and still the previous one in UTC-8. Whatever
    // TZ the test runs under, this is 28 September.
    expect(utcDayKey(new Date("2026-09-28T23:30:00.000Z"))).toBe("2026-09-28");
    expect(utcDayKey(new Date("2026-09-28T00:30:00.000Z"))).toBe("2026-09-28");
  });

  it("zero-pads single-digit months and days", () => {
    expect(utcDayKey(new Date("2026-01-05T09:00:00.000Z"))).toBe("2026-01-05");
  });
});

describe("previousUtcDay", () => {
  it("returns yesterday, not 24 hours ago", () => {
    expect(previousUtcDay(new Date("2026-09-29T00:10:00.000Z"))).toBe("2026-09-28");
    // Late in the day the two answers coincide; early in the day they do not, which is exactly
    // when the cron runs (00:20 UTC).
    expect(previousUtcDay(new Date("2026-09-29T23:50:00.000Z"))).toBe("2026-09-28");
  });

  it("rolls back across a month boundary", () => {
    expect(previousUtcDay(new Date("2026-10-01T00:20:00.000Z"))).toBe("2026-09-30");
  });

  it("rolls back across a year boundary", () => {
    expect(previousUtcDay(new Date("2027-01-01T00:20:00.000Z"))).toBe("2026-12-31");
  });

  it("handles a leap day in both directions", () => {
    expect(previousUtcDay(new Date("2028-03-01T00:20:00.000Z"))).toBe("2028-02-29");
    expect(previousUtcDay(new Date("2028-02-29T00:20:00.000Z"))).toBe("2028-02-28");
    // 2027 is not a leap year.
    expect(previousUtcDay(new Date("2027-03-01T00:20:00.000Z"))).toBe("2027-02-28");
  });
});

describe("isUtcDayKey", () => {
  it("accepts a well-formed day", () => {
    expect(isUtcDayKey("2026-09-28")).toBe(true);
    expect(isUtcDayKey("2028-02-29")).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    expect(isUtcDayKey("2026-02-30")).toBe(false);
    expect(isUtcDayKey("2027-02-29")).toBe(false);
    expect(isUtcDayKey("2026-13-01")).toBe(false);
    expect(isUtcDayKey("2026-00-10")).toBe(false);
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const bad of [
      "2026-9-28",
      "26-09-28",
      "2026-09-28T00:00:00.000Z",
      "2026/09/28",
      " 2026-09-28",
      "",
      null,
      undefined,
      20260928,
    ]) {
      expect(isUtcDayKey(bad), `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }
  });
});

describe("utcDayRange", () => {
  it("covers the whole day, inclusive at both ends", () => {
    const range = utcDayRange("2026-09-28");

    expect(range.from.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-28T23:59:59.999Z");
  });

  it("does not spill into the next day", () => {
    // The boundary that matters: a conversion at the next midnight belongs to the next day's
    // rows, and `{ gte, lte }` against this range is what keeps it there.
    const range = utcDayRange("2026-09-28");
    const nextMidnight = new Date("2026-09-29T00:00:00.000Z");

    expect(nextMidnight.getTime()).toBeGreaterThan(range.to.getTime());
  });

  it("refuses a key it cannot trust", () => {
    expect(() => utcDayRange("2026-02-30")).toThrow(RangeError);
    expect(() => utcDayRange("yesterday")).toThrow(RangeError);
  });
});

describe("utcDaysEndingWith", () => {
  it("returns the requested days oldest first, ending with the given day", () => {
    expect(utcDaysEndingWith("2026-10-02", 4)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("returns the day alone for a count of one or less", () => {
    expect(utcDaysEndingWith("2026-09-28", 1)).toEqual(["2026-09-28"]);
    expect(utcDaysEndingWith("2026-09-28", 0)).toEqual(["2026-09-28"]);
  });
});
