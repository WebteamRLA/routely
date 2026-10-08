import { describe, expect, it } from "vitest";

import { evenSplit, setWeight } from "@/lib/traffic";

describe("evenSplit", () => {
  it("gives the remainder to control and never mutates", () => {
    const input = [{ weight: 0 }, { weight: 0 }, { weight: 0 }];
    expect(evenSplit(input).map((a) => a.weight)).toEqual([34, 33, 33]);
    expect(input[0]!.weight).toBe(0);
    expect(evenSplit([{ weight: 1 }, { weight: 1 }]).map((a) => a.weight)).toEqual([50, 50]);
    expect(
      evenSplit(Array.from({ length: 5 }, () => ({ weight: 0 }))).map((a) => a.weight),
    ).toEqual([20, 20, 20, 20, 20]);
    expect(evenSplit([])).toEqual([]);
  });
});

describe("setWeight", () => {
  const w = (...ws: number[]) => ws.map((weight) => ({ weight }));
  const of = (arms: { weight: number }[]) => arms.map((a) => a.weight);

  it("balances two arms", () => {
    expect(of(setWeight(w(50, 50), 1, 30))).toEqual([70, 30]);
    expect(of(setWeight(w(50, 50), 0, 150))).toEqual([100, 0]);
    expect(of(setWeight(w(50, 50), 0, -5))).toEqual([0, 100]);
    expect(of(setWeight(w(50, 50), 0, "abc"))).toEqual([0, 100]);
    expect(of(setWeight(w(50, 50), 0, "33.6"))).toEqual([34, 66]);
  });

  it("shares the rest proportionally across 3+ arms, remainder to the first other arm", () => {
    expect(of(setWeight(w(34, 33, 33), 1, 50))).toEqual([26, 50, 24]);
    expect(of(setWeight(w(20, 20, 20, 20, 20), 4, 60))).toEqual([10, 10, 10, 10, 60]);
    expect(of(setWeight(w(0, 0, 100), 2, 40))).toEqual([30, 30, 40]);
  });

  it("always totals 100 and leaves the input alone", () => {
    const input = w(10, 20, 30, 40);
    for (let i = 0; i < 4; i++) {
      for (const v of [0, 1, 37, 99, 100]) {
        const out = setWeight(input, i, v);
        expect(of(out).reduce((a, b) => a + b, 0)).toBe(100);
        expect(out[i]!.weight).toBe(v);
      }
    }
    expect(of(input)).toEqual([10, 20, 30, 40]);
  });

  it("ignores an out-of-range index", () => {
    expect(of(setWeight(w(50, 50), 5, 10))).toEqual([50, 50]);
  });
});
