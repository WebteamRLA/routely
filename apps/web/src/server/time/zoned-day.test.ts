import { describe, expect, it } from "vitest";

import { addDays, dayKeyInZone, daysBetween, startOfDayInZone } from "@/server/time/zoned-day";

describe("dayKeyInZone", () => {
  it("assigns an instant to the project's local day", () => {
    const lateEvening = new Date("2026-10-09T03:30:00Z"); // 23:30 on the 8th in New York
    expect(dayKeyInZone(lateEvening, "America/New_York")).toBe("2026-10-08");
    expect(dayKeyInZone(lateEvening, "UTC")).toBe("2026-10-09");
    expect(dayKeyInZone(lateEvening, "Asia/Singapore")).toBe("2026-10-09");
  });

  it("falls back to UTC for an unknown zone rather than throwing", () => {
    expect(dayKeyInZone(new Date("2026-10-09T03:30:00Z"), "Mars/Base")).toBe("2026-10-09");
  });
});

describe("day arithmetic", () => {
  it("adds days across month ends and DST changes", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("lists every day inclusive", () => {
    expect(daysBetween("2026-10-06", "2026-10-08")).toEqual([
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    expect(daysBetween("2026-10-09", "2026-10-08")).toEqual([]);
  });
});

describe("startOfDayInZone", () => {
  it("finds local midnight", () => {
    expect(startOfDayInZone("2026-10-08", "America/New_York").toISOString()).toBe(
      "2026-10-08T04:00:00.000Z",
    );
    expect(startOfDayInZone("2026-12-08", "America/New_York").toISOString()).toBe(
      "2026-12-08T05:00:00.000Z",
    );
    expect(startOfDayInZone("2026-10-08", "Asia/Singapore").toISOString()).toBe(
      "2026-10-07T16:00:00.000Z",
    );
    expect(startOfDayInZone("2026-10-08", "UTC").toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("is the first instant of that local day across a DST change", () => {
    const start = startOfDayInZone("2026-03-08", "America/New_York");
    expect(dayKeyInZone(start, "America/New_York")).toBe("2026-03-08");
    expect(dayKeyInZone(new Date(start.getTime() - 1), "America/New_York")).toBe("2026-03-07");
  });
});
