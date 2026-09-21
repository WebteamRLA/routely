import { describe, expect, it } from "vitest";

import { applyShare, armShares, roundToTotal } from "@/lib/traffic";

/** Every distribution the editor can produce must still total exactly 100. */
const totals = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

describe("applyShare", () => {
  // Control, three variants, excluded — the shape from the bug report.
  const START = [25, 25, 25, 25, 0];
  const EXCLUDED = 4;

  it("keeps the typed value exactly", () => {
    expect(applyShare(START, 2, 20, EXCLUDED)[2]).toBe(20);
    expect(applyShare(START, 0, 7, EXCLUDED)[0]).toBe(7);
    expect(applyShare(START, 3, 91, EXCLUDED)[3]).toBe(91);
  });

  it("preserves a whole typed sequence across four arms", () => {
    // The reported case: typing 25 / 25 / 20 / 30 used to store 26 / 25 / 19 / 30.
    let percents = START;
    for (const [index, value] of [
      [0, 25],
      [1, 25],
      [2, 20],
      [3, 30],
    ] as const) {
      percents = applyShare(percents, index, value, EXCLUDED);
    }

    expect(percents.slice(0, 4)).toEqual([25, 25, 20, 30]);
    expect(percents[EXCLUDED]).toBe(0);
  });

  it("takes the change out of excluded before any other arm", () => {
    // Shrinking one arm must park the freed traffic in excluded, not hand it to its neighbours.
    const next = applyShare(START, 2, 20, EXCLUDED);
    expect(next).toEqual([25, 25, 20, 25, 5]);
  });

  it("gives traffic back from excluded when an arm grows", () => {
    const next = applyShare([25, 25, 20, 25, 5], 3, 30, EXCLUDED);
    expect(next).toEqual([25, 25, 20, 30, 0]);
  });

  it("falls back to the other arms once excluded is empty", () => {
    const next = applyShare([25, 25, 20, 30, 0], 3, 90, EXCLUDED);

    expect(next[3]).toBe(90);
    expect(next[EXCLUDED]).toBe(0);
    expect(totals(next)).toBe(100);
    // The remaining 10 points are split in proportion to what those arms held.
    expect(next.slice(0, 3)).toEqual([4, 3, 3]);
  });

  it("rebalances the arms when excluded itself is edited", () => {
    const next = applyShare(START, EXCLUDED, 20, EXCLUDED);

    expect(next[EXCLUDED]).toBe(20);
    expect(totals(next)).toBe(100);
    expect(next.slice(0, 4)).toEqual([20, 20, 20, 20]);
  });

  it("can bring an arm back from zero", () => {
    // A proportional rescale can never revive a zeroed arm, because zero times anything is zero.
    const next = applyShare([100, 0, 0, 0, 0], 2, 40, EXCLUDED);
    expect(next[2]).toBe(40);
    expect(totals(next)).toBe(100);
  });

  it("totals 100 for any arm count, value and target", () => {
    for (const arms of [2, 3, 4, 5, 8]) {
      const excluded = arms;
      const start = [...Array(arms).fill(Math.floor(100 / arms)), 0];
      start[0] += 100 - totals(start);

      for (let index = 0; index <= arms; index += 1) {
        for (const value of [0, 1, 33, 50, 99, 100]) {
          const next = applyShare(start, index, value, excluded);
          expect(totals(next), `${arms} arms, index ${index}, value ${value}`).toBe(100);
          expect(next.every((percent) => percent >= 0)).toBe(true);
          expect(next[index]).toBe(value);
        }
      }
    }
  });

  it("clamps nonsense rather than producing a broken distribution", () => {
    expect(totals(applyShare(START, 1, -40, EXCLUDED))).toBe(100);
    expect(totals(applyShare(START, 1, 999, EXCLUDED))).toBe(100);
    expect(totals(applyShare(START, 1, Number.NaN, EXCLUDED))).toBe(100);
    expect(applyShare(START, 9, 50, EXCLUDED)).toEqual(START);
  });
});

describe("armShares", () => {
  it("splits evenly across any number of variants", () => {
    const shares = armShares({
      controlWeight: 25,
      variantWeights: [25, 25, 25],
      trafficAllocation: 100,
    });

    expect(shares.control).toBe(25);
    expect(shares.variants).toEqual([25, 25, 25]);
    expect(shares.control + totals(shares.variants) + shares.excluded).toBe(100);
  });

  it("round-trips the weights the editor stores", () => {
    // The editor stores absolute percentages as relative weights, so reading them back must
    // give the same picture — otherwise a saved experiment displays a different split.
    const shares = armShares({
      controlWeight: 25,
      variantWeights: [25, 20, 30],
      trafficAllocation: 100,
    });

    expect(shares.control).toBe(25);
    expect(shares.variants).toEqual([25, 20, 30]);
  });

  it("keeps the total at 100 once traffic is excluded", () => {
    const shares = armShares({
      controlWeight: 40,
      variantWeights: [30, 30],
      trafficAllocation: 70,
    });

    expect(shares.excluded).toBe(30);
    expect(shares.control + totals(shares.variants) + shares.excluded).toBe(100);
  });

  it("totals 100 across awkward weight and allocation combinations", () => {
    for (const allocation of [1, 33, 67, 99, 100]) {
      for (const weights of [
        [1, 1, 1],
        [7, 11, 13, 17],
        [1, 0, 0],
        [3, 3, 3, 3, 3, 3, 3],
      ]) {
        const shares = armShares({
          controlWeight: 1,
          variantWeights: weights,
          trafficAllocation: allocation,
        });

        expect(
          shares.control + totals(shares.variants) + shares.excluded,
          `allocation ${allocation}, weights ${weights.join("/")}`,
        ).toBe(100);
        expect(shares.variants).toHaveLength(weights.length);
      }
    }
  });
});

describe("roundToTotal", () => {
  it("hits the total exactly", () => {
    expect(totals(roundToTotal([33.3, 33.3, 33.3], 100))).toBe(100);
    expect(totals(roundToTotal([0.5, 0.5, 99], 100))).toBe(100);
  });
});
