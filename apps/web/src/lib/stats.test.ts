import { describe, expect, it } from "vitest";

import { computeStats, phi, sliceDaily, statsFromDaily, type ArmCounts } from "./stats";

const arms = (...counts: [number, number][]): ArmCounts[] =>
  counts.map(([v, c], i) => ({ name: i ? `Variant ${"ABCD"[i - 1]}` : "Control", v, c }));

describe("phi", () => {
  it("approximates the standard normal CDF", () => {
    expect(phi(0)).toBeCloseTo(0.5, 6);
    expect(phi(1.96)).toBeCloseTo(0.975, 4);
    expect(phi(-1.96)).toBeCloseTo(0.025, 4);
    expect(phi(3)).toBeCloseTo(0.99865, 4);
  });

  it("is symmetric", () => {
    for (const z of [0.3, 1, 2.5]) expect(phi(z) + phi(-z)).toBeCloseTo(1, 6);
  });
});

describe("computeStats", () => {
  it("matches the prototype for a clear two-arm difference", () => {
    const s = computeStats(arms([1000, 50], [1000, 65]));
    const [c, a] = s.arms;
    expect(c!.cr).toBe(0.05);
    expect(c!.lift).toBe(0);
    expect(c!.prob).toBeNull();
    expect(a!.cr).toBe(0.065);
    expect(a!.lift).toBeCloseTo(0.3, 10);
    expect(a!.prob).toBeCloseTo(0.925284094939051, 12);
    expect(a!.lo).toBeCloseTo(-0.10789667319065006, 12);
    expect(a!.hi).toBeCloseTo(0.70789667319065, 12);
    expect(a!.p).toBeCloseTo(0.1494318101218981, 12);
    expect(s.v).toBe(2000);
    expect(s.c).toBe(115);
    expect(a!.color).toBe("#2B59F0");
  });

  it("handles zero visitors without dividing by zero", () => {
    const [, a] = computeStats(arms([0, 0], [0, 0])).arms;
    expect(a).toMatchObject({ cr: 0, lift: 0, prob: 0.5, lo: 0, hi: 0, p: 1 });
  });

  it("reports zero lift and CI when control converts at 0%", () => {
    const [, a] = computeStats(arms([100, 0], [100, 5])).arms;
    expect(a!.lift).toBe(0);
    expect(a!.lo).toBe(0);
    expect(a!.hi).toBe(0);
    expect(a!.prob).toBeCloseTo(0.9891093001343076, 12);
  });

  it("clamps the chance to beat control to .006–.994", () => {
    expect(computeStats(arms([100000, 1000], [100000, 3000])).arms[1]!.prob).toBe(0.994);
    expect(computeStats(arms([100000, 3000], [100000, 1000])).arms[1]!.prob).toBe(0.006);
  });

  it("compares every one of five arms against control", () => {
    const s = computeStats(arms([2000, 100], [2000, 90], [2000, 130], [2000, 105], [2000, 99]));
    expect(s.arms).toHaveLength(5);
    expect(s.arms[2]!.prob).toBeCloseTo(0.9792574657700529, 12);
    expect(s.arms[1]!.lift).toBeCloseTo(-0.1, 10);
    expect(s.arms.map((a) => a.i)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the interval finite when counting ALL puts a rate above 100%", () => {
    const [, a] = computeStats(arms([6, 8], [3, 3])).arms;
    expect(a!.cr).toBe(1);
    expect(Number.isFinite(a!.lo)).toBe(true);
    expect(Number.isFinite(a!.hi)).toBe(true);
    expect(Number.isFinite(a!.p)).toBe(true);
  });

  it("returns empty stats for no arms", () => {
    expect(computeStats([])).toMatchObject({ arms: [], v: 0, c: 0, n: 0 });
  });
});

describe("sliceDaily", () => {
  const daily = [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ v: v * 10, c: v })),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ v: v * 10, c: v * 2 })),
  ];

  it("sums the last N days", () => {
    const s = sliceDaily(daily, "7");
    expect(s).toMatchObject({ start: 3, days: 10, n: 7 });
    expect(s.arms[0]).toEqual({ v: 490, c: 49 });
    expect(s.arms[1]).toEqual({ v: 490, c: 98 });
  });

  it("uses everything when the range is longer than the data, or all", () => {
    expect(sliceDaily(daily, "30")).toMatchObject({ start: 0, n: 10 });
    expect(sliceDaily(daily, "all").arms[0]).toEqual({ v: 550, c: 55 });
  });

  it("handles no data", () => {
    expect(sliceDaily([], "14")).toEqual({ arms: [], start: 0, days: 0, n: 0 });
    expect(sliceDaily([[], []], "all").arms).toEqual([
      { v: 0, c: 0 },
      { v: 0, c: 0 },
    ]);
  });

  it("feeds computeStats via statsFromDaily", () => {
    const s = statsFromDaily([{ name: "Control" }, { name: "Variant A", weight: 50 }], daily, "14");
    expect(s.n).toBe(10);
    expect(s.arms[1]).toMatchObject({ name: "Variant A", weight: 50, v: 550, c: 110 });
  });
});
