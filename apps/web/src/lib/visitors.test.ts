import { beforeEach, describe, expect, it, vi } from "vitest";

const visitorDayRepo = vi.hoisted(() => ({
  countVisitorsByDay: vi.fn(),
  countDistinctVisitors: vi.fn(),
}));
const pageVisitorDayRepo = vi.hoisted(() => ({ countPageVisitorDays: vi.fn() }));

vi.mock("@/server/repositories/visitor-day.repository", () => visitorDayRepo);
vi.mock("@/server/repositories/page-visitor-day.repository", () => pageVisitorDayRepo);

import {
  baselineFromCount,
  dailyVisitors,
  dayWindow,
  pageBaseline,
  visitors30,
  zeroFill,
} from "./visitors";

const now = new Date("2026-10-19T08:30:00.000Z");
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("dayWindow", () => {
  it("covers today and the days before it, oldest first, in UTC", () => {
    const window = dayWindow(3, now);
    expect(window.keys).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
    expect(window.from.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("uses the UTC day even just before midnight", () => {
    expect(dayWindow(1, new Date("2026-10-19T23:59:59.999Z")).keys).toEqual(["2026-10-19"]);
  });

  it("is never empty", () => {
    expect(dayWindow(0, now).keys).toEqual(["2026-10-19"]);
  });

  it("crosses month boundaries", () => {
    expect(dayWindow(30, now).keys[0]).toBe("2026-09-20");
  });
});

describe("zeroFill", () => {
  it("fills days with no rows with 0", () => {
    expect(
      zeroFill(
        ["2026-10-17", "2026-10-18", "2026-10-19"],
        [{ day: day("2026-10-18"), visitors: 4 }],
      ),
    ).toEqual([
      { day: "2026-10-17", visitors: 0 },
      { day: "2026-10-18", visitors: 4 },
      { day: "2026-10-19", visitors: 0 },
    ]);
  });
});

describe("baselineFromCount", () => {
  it("averages over the window and rounds", () => {
    expect(baselineFromCount(45, 30)).toBe(2);
    expect(baselineFromCount(3600, 30)).toBe(120);
    expect(baselineFromCount(10, 30)).toBe(0);
  });

  it("is null with no traffic", () => {
    expect(baselineFromCount(0, 30)).toBeNull();
  });
});

describe("read models", () => {
  it("dailyVisitors queries the window and zero-fills", async () => {
    visitorDayRepo.countVisitorsByDay.mockResolvedValue([{ day: day("2026-10-19"), visitors: 7 }]);
    const result = await dailyVisitors("w1", 2, now);
    expect(visitorDayRepo.countVisitorsByDay).toHaveBeenCalledWith(
      "w1",
      day("2026-10-18"),
      day("2026-10-19"),
    );
    expect(result).toEqual([
      { day: "2026-10-18", visitors: 0 },
      { day: "2026-10-19", visitors: 7 },
    ]);
  });

  it("visitors30 counts distinct visitors over 30 days including today", async () => {
    visitorDayRepo.countDistinctVisitors.mockResolvedValue(12);
    expect(await visitors30("w1", now)).toBe(12);
    expect(visitorDayRepo.countDistinctVisitors).toHaveBeenCalledWith(
      "w1",
      day("2026-09-20"),
      day("2026-10-19"),
    );
  });

  it("pageBaseline looks up the normalised URL", async () => {
    pageVisitorDayRepo.countPageVisitorDays.mockResolvedValue(90);
    expect(await pageBaseline("w1", "https://Acme.com/pricing/?utm_source=x#plans", now)).toBe(3);
    expect(pageVisitorDayRepo.countPageVisitorDays).toHaveBeenCalledWith(
      "w1",
      "https://acme.com/pricing",
      day("2026-09-20"),
      day("2026-10-19"),
    );
  });

  it("pageBaseline is null without traffic or for an unusable URL", async () => {
    pageVisitorDayRepo.countPageVisitorDays.mockResolvedValue(0);
    expect(await pageBaseline("w1", "https://acme.com/", now)).toBeNull();
    expect(await pageBaseline("w1", "not a url", now)).toBeNull();
  });
});
