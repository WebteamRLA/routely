import { describe, expect, it } from "vitest";

import { percentAxis } from "@/lib/chart-axis";

describe("percentAxis", () => {
  it("keeps 1% steps for low rates, as the design drew them", () => {
    expect(percentAxis(0)).toEqual({ maxPct: 1, ticks: [0, 1] });
    expect(percentAxis(0.042)).toEqual({ maxPct: 5, ticks: [0, 1, 2, 3, 4, 5] });
  });

  it("widens the step so a high rate never gets more than seven labels", () => {
    expect(percentAxis(0.5)).toEqual({ maxPct: 60, ticks: [0, 10, 20, 30, 40, 50, 60] });
    expect(percentAxis(0.11).ticks).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(percentAxis(0.27).ticks).toEqual([0, 5, 10, 15, 20, 25, 30]);
    for (let r = 0; r <= 1; r += 0.01) {
      const axis = percentAxis(r);
      expect(axis.ticks.length).toBeLessThanOrEqual(7);
      expect(axis.maxPct).toBeGreaterThanOrEqual(r * 100);
    }
  });

  it("tops out at 100%", () => {
    expect(percentAxis(1)).toEqual({ maxPct: 100, ticks: [0, 20, 40, 60, 80, 100] });
  });
});
