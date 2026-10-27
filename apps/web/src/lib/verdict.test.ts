import { describe, expect, it } from "vitest";

import {
  LOSE_CHANCE,
  MIN_CONVERSIONS_PER_ARM,
  MIN_VISITORS_PER_ARM,
  MINUS,
  WIN_CHANCE,
  analyzeResults,
  armProgress,
  betaCdf,
  chanceToBeatControl,
  completedOutcomeSentence,
  conversionRate,
  conversionsStillNeeded,
  cumulativeSeries,
  deltaPts,
  experimentVerdict,
  formatChance,
  formatLift,
  formatPtsVsControl,
  leaderByRate,
  logGamma,
  noteTone,
  pauseResultLabel,
  pooledRate,
  relativeLift,
  resultNote,
  resultStatusOf,
  rowVerdict,
  showCumulativeChart,
  winnerBadge,
  wizardVerdict,
  type ArmCounts,
  decisionBadge,
  decisionVerdict,
  manualChoiceCaveat,
  recommendedArm,
  storedDecision,
  winnerBasis,
} from "@/lib/verdict";

const arm = (name: string, visitors: number, conversions: number): ArmCounts => ({
  name,
  visitors,
  conversions,
});

/**
 * Independent reference: Evan Miller's closed form for P(X_B > X_A), X ~ Beta, as an O(α_B) sum.
 * Exact for integer α_B, so it checks the quadrature on small counts.
 */
function closedForm(
  control: { visitors: number; conversions: number },
  variant: { visitors: number; conversions: number },
): number {
  const lb = (a: number, b: number) => logGamma(a) + logGamma(b) - logGamma(a + b);
  const aA = 1 + control.conversions;
  const bA = 1 + control.visitors - control.conversions;
  const aB = 1 + variant.conversions;
  const bB = 1 + variant.visitors - variant.conversions;
  let total = 0;
  for (let i = 0; i < aB; i++) {
    total += Math.exp(lb(aA + i, bA + bB) - Math.log(bB + i) - lb(1 + i, bB) - lb(aA, bA));
  }
  return total;
}

/** Normal approximation to the difference of two Betas — accurate when counts are large. */
function normalApprox(
  control: { visitors: number; conversions: number },
  variant: { visitors: number; conversions: number },
): number {
  const moments = (n: number, c: number) => {
    const a = 1 + c;
    const b = 1 + n - c;
    return { m: a / (a + b), v: (a * b) / ((a + b) ** 2 * (a + b + 1)) };
  };
  const x = moments(control.visitors, control.conversions);
  const y = moments(variant.visitors, variant.conversions);
  const z = (y.m - x.m) / Math.sqrt(x.v + y.v);
  // Φ via erf series is overkill here; use the complementary error function by integration.
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz–Stegun 7.1.26 is only ~1e-7; fine for a 1e-3 comparison.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x < 0 ? -y : y;
}

describe("logGamma and betaCdf", () => {
  it("matches known Γ values", () => {
    expect(logGamma(1)).toBeCloseTo(0, 12);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    // Stirling check at 1e7: ln Γ(x) ≈ (x − ½) ln x − x + ½ ln 2π + 1/(12x)
    const x = 1e7;
    const stirling = (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * x);
    expect(Math.abs(logGamma(x) - stirling) / stirling).toBeLessThan(1e-13);
  });

  it("is the uniform CDF for Beta(1,1) and closed forms elsewhere", () => {
    expect(betaCdf(0.3, 1, 1)).toBeCloseTo(0.3, 12);
    expect(betaCdf(0.3, 2, 1)).toBeCloseTo(0.09, 12); // x²
    expect(betaCdf(0.3, 1, 2)).toBeCloseTo(1 - 0.49, 12); // 1 − (1 − x)²
    expect(betaCdf(0, 3, 4)).toBe(0);
    expect(betaCdf(1, 3, 4)).toBe(1);
  });

  it("puts half the mass below the mean of a large symmetric Beta", () => {
    expect(betaCdf(0.5, 5e6, 5e6)).toBeCloseTo(0.5, 9);
  });
});

describe("chanceToBeatControl", () => {
  it("is exactly 0.5 with no data and for identical counts", () => {
    expect(chanceToBeatControl(arm("C", 0, 0), arm("V", 0, 0))).toBe(0.5);
    expect(chanceToBeatControl(arm("C", 4000, 120), arm("V", 4000, 120))).toBe(0.5);
  });

  it("matches hand-derived reference values", () => {
    // Beta(1,2) control vs Beta(2,1) variant: ∫ 2x (2x − x²) dx = 5/6.
    expect(chanceToBeatControl(arm("C", 1, 0), arm("V", 1, 1))).toBeCloseTo(5 / 6, 10);
    // Beta(1,2) control vs uniform variant: ∫ (1 − x) · 2(1 − x) dx = 2/3.
    expect(chanceToBeatControl(arm("C", 1, 0), arm("V", 0, 0))).toBeCloseTo(2 / 3, 10);
    // Uniform control vs Beta(501,1) variant: E[X] = 501/502 (a steep, skewed posterior).
    expect(chanceToBeatControl(arm("C", 0, 0), arm("V", 500, 500))).toBeCloseTo(501 / 502, 9);
    // Uniform control vs Beta(1,2) variant: 1/3.
    expect(chanceToBeatControl(arm("C", 0, 0), arm("V", 1, 0))).toBeCloseTo(1 / 3, 10);
  });

  it("matches the exact closed-form sum on small and moderate counts", () => {
    const cases: [number, number, number, number][] = [
      [10, 2, 10, 5],
      [100, 3, 120, 9],
      [1000, 100, 1000, 130],
      [1000, 100, 1000, 100],
      [2500, 90, 2400, 70],
      [50, 0, 5000, 10],
      [5000, 10, 50, 0],
      [3, 3, 0, 0],
      [200, 200, 200, 199],
    ];
    for (const [n1, c1, n2, c2] of cases) {
      const control = arm("C", n1, c1);
      const variant = arm("V", n2, c2);
      expect(chanceToBeatControl(control, variant)).toBeCloseTo(closedForm(control, variant), 6);
    }
  });

  it("is symmetric: P(a > b) + P(b > a) = 1", () => {
    const pairs: [ArmCounts, ArmCounts][] = [
      [arm("A", 12, 1), arm("B", 30, 7)],
      [arm("A", 1000, 100), arm("B", 1200, 140)],
      [arm("A", 120, 4), arm("B", 1e7, 3e5)],
      [arm("A", 1e7, 3e5), arm("B", 1e7, 302_000)],
      [arm("A", 0, 0), arm("B", 500, 500)],
    ];
    for (const [a, b] of pairs) {
      expect(chanceToBeatControl(a, b) + chanceToBeatControl(b, a)).toBeCloseTo(1, 12);
    }
  });

  it("agrees with the normal approximation, stays finite and is fast at 10^7", () => {
    const sizes = [1e5, 1e6, 1e7];
    const started = performance.now();
    for (const n of sizes) {
      const control = arm("C", n, Math.round(n * 0.03));
      const variant = arm("V", n, Math.round(n * 0.0302));
      const p = chanceToBeatControl(control, variant);
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeCloseTo(normalApprox(control, variant), 3);
    }
    // Lopsided: a tiny control against a huge variant (the narrow posterior is the density).
    const lopsided = chanceToBeatControl(arm("C", 120, 4), arm("V", 1e7, 3e5));
    expect(lopsided).toBeCloseTo(closedForm(arm("C", 120, 4), arm("V", 1e7, 3e5)), 6);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("saturates without overflowing for overwhelming differences", () => {
    const up = chanceToBeatControl(arm("C", 1e7, 1e5), arm("V", 1e7, 2e5));
    const down = chanceToBeatControl(arm("C", 1e7, 2e5), arm("V", 1e7, 1e5));
    expect(up).toBeGreaterThan(0.999999);
    expect(up).toBeLessThanOrEqual(1);
    expect(down).toBeLessThan(1e-6);
    expect(down).toBeGreaterThanOrEqual(0);
  });

  it("handles zero control rate and full conversion", () => {
    expect(chanceToBeatControl(arm("C", 2000, 0), arm("V", 2000, 5))).toBeGreaterThan(0.95);
    expect(chanceToBeatControl(arm("C", 2000, 2000), arm("V", 2000, 1990))).toBeLessThan(0.05);
  });

  it("clamps nonsense counts instead of returning NaN", () => {
    const p = chanceToBeatControl(arm("C", 10, 50), arm("V", -3, 2.7));
    expect(Number.isFinite(p)).toBe(true);
  });
});

describe("rates and lifts", () => {
  it("divides by assigned visitors and treats no visitors as 0", () => {
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(200, 7)).toBeCloseTo(0.035, 12);
  });

  it("relativeLift is null at a zero control rate", () => {
    expect(relativeLift(0.04, 0)).toBeNull();
    expect(relativeLift(0.041, 0.0349)).toBeCloseTo(0.0349 > 0 ? 0.041 / 0.0349 - 1 : 0, 12);
  });

  it("deltaPts is in percentage points, matching the design's e5/e6", () => {
    expect(formatPtsVsControl(deltaPts(0.041, 0.0349))).toBe("+0.6 pts vs control");
    expect(formatPtsVsControl(deltaPts(0.0251, 0.027))).toBe(`${MINUS}0.2 pts vs control`);
    expect(formatPtsVsControl(deltaPts(0.0301, 0.03))).toBe("0.0 pts vs control");
  });

  it("pooledRate sums every arm and is null with no visitors", () => {
    expect(pooledRate([arm("C", 0, 0), arm("V", 0, 0)])).toBeNull();
    expect(pooledRate([arm("C", 100, 3), arm("V", 300, 13)])).toBeCloseTo(16 / 400, 12);
  });
});

describe("formatting", () => {
  it("formats lifts with U+2212", () => {
    expect(formatLift(0.123)).toBe("+12.3%");
    expect(formatLift(-0.04)).toBe(`${MINUS}4.0%`);
    expect(formatLift(null)).toBe("—");
  });

  it("formats chance at 1 dp and never claims certainty", () => {
    expect(formatChance(0.974)).toBe("97.4%");
    expect(formatChance(null)).toBe("—");
    expect(formatChance(0.99999)).toBe(">99.9%");
    expect(formatChance(0.999)).toBe("99.9%");
    expect(formatChance(0.00001)).toBe("<0.1%");
    expect(formatChance(0.62, 0)).toBe("62%");
    expect(formatChance(0.996, 0)).toBe(">99%");
  });

  it("colours notes by their first character", () => {
    expect(noteTone("+0.6 pts vs control")).toBe("positive");
    expect(noteTone(`${MINUS}0.2 pts vs control`)).toBe("negative");
    expect(noteTone("0.0 pts vs control")).toBe("neutral");
    expect(noteTone("collecting data")).toBe("neutral");
  });
});

describe("analyzeResults — the gate", () => {
  const V = MIN_VISITORS_PER_ARM;
  const C = MIN_CONVERSIONS_PER_ARM;

  it("exports the approved thresholds", () => {
    expect([V, C, WIN_CHANCE, LOSE_CHANCE]).toEqual([1000, 100, 0.95, 0.05]);
  });

  it("has no data, no chance and no best with zero visitors", () => {
    const a = analyzeResults([arm("Control", 0, 0), arm("Variant", 0, 0)]);
    expect(a.hasData).toBe(false);
    expect(a.enough).toBe(false);
    expect(a.variants[0]!.chance).toBeNull();
    expect(a.best).toBeNull();
    expect(a.winner).toBeNull();
    expect(a.controlWins).toBe(false);
    expect(a.pooledRate).toBeNull();
  });

  it("opens exactly at 1,000 visitors and 100 conversions on every arm", () => {
    expect(analyzeResults([arm("Control", V, C), arm("Variant", V, C)]).enough).toBe(true);
    expect(analyzeResults([arm("Control", V - 1, C), arm("Variant", V, C)]).enough).toBe(false);
    expect(analyzeResults([arm("Control", V, C), arm("Variant", V, C - 1)]).enough).toBe(false);
    expect(
      analyzeResults([arm("Control", V, C), arm("A", V, C), arm("B", V - 1, 400)]).enough,
    ).toBe(false);
  });

  it("does not name a winner below the gate, however lopsided", () => {
    const a = analyzeResults([arm("Control", 999, 10), arm("Variant", 999, 300)]);
    expect(a.variants[0]!.chance).toBeGreaterThan(0.999);
    expect(a.winner).toBeNull();
    expect(a.controlWins).toBe(false);
  });

  it("names a winner at ≥ 0.95 and control at ≤ 0.05 for every variant", () => {
    const win = analyzeResults([arm("Control", 5000, 150), arm("Variant", 5000, 200)]);
    expect(win.winner?.name).toBe("Variant");
    expect(win.controlWins).toBe(false);

    const lose = analyzeResults([arm("Control", 5000, 200), arm("Variant", 5000, 150)]);
    expect(lose.winner).toBeNull();
    expect(lose.controlWins).toBe(true);

    const mixed = analyzeResults([
      arm("Control", 5000, 200),
      arm("Variant A", 5000, 150),
      arm("Variant B", 5000, 198),
    ]);
    expect(mixed.controlWins).toBe(false);
    expect(mixed.best?.name).toBe("Variant B");
  });

  it("picks the first variant on a tie for best", () => {
    const a = analyzeResults([
      arm("Control", 2000, 120),
      arm("Variant A", 2000, 150),
      arm("Variant B", 2000, 150),
    ]);
    expect(a.best?.name).toBe("Variant A");
  });

  it("computes lift as null when control's rate is 0", () => {
    const a = analyzeResults([arm("Control", 50, 0), arm("Variant", 50, 3)]);
    expect(a.variants[0]!.lift).toBeNull();
    expect(a.control.lift).toBeNull();
    expect(a.control.chance).toBeNull();
  });

  it("refuses an empty arm list", () => {
    expect(() => analyzeResults([])).toThrow(RangeError);
  });
});

describe("rowVerdict", () => {
  it("follows control / no data / gate / thresholds", () => {
    const none = analyzeResults([arm("Control", 0, 0), arm("Variant", 0, 0)]);
    expect(rowVerdict(none.variants[0]!, none)).toBe("");

    const early = analyzeResults([arm("Control", 400, 10), arm("Variant", 400, 30)]);
    expect(rowVerdict(early.control, early)).toBe("");
    expect(rowVerdict(early.variants[0]!, early)).toBe("Needs more data");

    const r = analyzeResults([
      arm("Control", 5000, 200),
      arm("A", 5000, 280),
      arm("B", 5000, 140),
      arm("C", 5000, 205),
    ]);
    expect(r.variants.map((v) => rowVerdict(v, r))).toEqual([
      "Likely better",
      "Likely worse",
      "Not significant yet",
    ]);
  });

  it("labels the winning row by status", () => {
    expect(winnerBadge("running")).toBe("Likely winner");
    expect(winnerBadge("paused")).toBe("Likely winner");
    expect(winnerBadge("completed")).toBe("Winner");
  });
});

describe("experimentVerdict", () => {
  const winning = analyzeResults([arm("Control", 6200, 216), arm("Variant", 6280, 257)]);
  const flat = analyzeResults([arm("Control", 5000, 150), arm("Variant", 5000, 155)]);
  const early = analyzeResults([arm("Control", 1840, 40), arm("Variant", 1820, 43)]);

  it("row 1: collecting data", () => {
    const v = experimentVerdict(analyzeResults([arm("Control", 0, 0), arm("V", 0, 0)]), {
      status: "running",
    });
    expect(v).toEqual({
      kind: "collect",
      title: "Collecting data",
      body: "No visitors yet. Results appear here as soon as visitors reach the tested page.",
    });
  });

  it("row 2: a live winner says 'update your site', never 'roll out'", () => {
    const v = experimentVerdict(winning, { status: "running" });
    expect(v.kind).toBe("win");
    expect(v.title).toBe("Variant is likely better than Control");
    expect(v.body).toMatch(
      /^Variant converts \d+\.\d% better than Control \(4\.09% vs 3\.48%\), with a \d+\.\d% chance to beat it\. Every version has passed 1,000 visitors and 100 conversions, so you can end the test and update your site to Variant\.$/,
    );
    expect(v.body).not.toMatch(/roll out/);
  });

  it("row 2: a completed winner", () => {
    const v = experimentVerdict(winning, { status: "completed", endedLabel: "Sep 30", days: 29 });
    expect(v.title).toBe("Variant won");
    expect(v.body.startsWith("Ended Sep 30 after 29 days. Variant converts ")).toBe(true);
  });

  it("row 3: control is likely better", () => {
    const a = analyzeResults([arm("Control", 5000, 200), arm("Variant", 5000, 150)]);
    expect(experimentVerdict(a, { status: "running" })).toEqual({
      kind: "win",
      title: "Control is likely better",
      body: "No variant beats Control. Every version has enough data, and Control converts at 4.00%.",
    });
  });

  it("row 4: no clear winner, with the paused suffix", () => {
    const running = experimentVerdict(flat, { status: "running" });
    expect(running.kind).toBe("flat");
    expect(running.title).toBe("No clear winner yet");
    expect(running.body).toMatch(
      /^Every version has enough data, but the difference isn’t significant \(Control 3\.00% vs Variant 3\.10%\)\. Variant has a \d+% chance to beat Control\.$/,
    );
    expect(experimentVerdict(flat, { status: "completed" }).title).toBe("No clear winner");
    expect(
      experimentVerdict(flat, { status: "paused" }).body.endsWith(
        " It’s paused, so no new data is coming in.",
      ),
    ).toBe(true);
  });

  it("row 5: ended before a result names the leader by rate", () => {
    const v = experimentVerdict(early, { status: "completed" });
    expect(v).toEqual({
      kind: "wait",
      title: "Ended before a result",
      body: "This experiment ended before every version reached 1,000 visitors and 100 conversions, so Routely didn’t call a winner. Variant was ahead at 2.36%, but the difference could be chance.",
    });
  });

  it("row 6: not enough data, running and paused", () => {
    expect(experimentVerdict(early, { status: "running" })).toEqual({
      kind: "wait",
      title: "Not enough data to call a winner yet",
      body: "Each version needs at least 1,000 visitors and 100 conversions before Routely suggests a winner. Early differences often disappear, so keep the experiment running.",
    });
    expect(experimentVerdict(early, { status: "paused" }).body).toBe(
      "Each version needs at least 1,000 visitors and 100 conversions before Routely suggests a winner. It’s paused, so no new data is coming in. Resume it to keep collecting.",
    );
  });

  it("leaderByRate keeps Control on a tie", () => {
    expect(leaderByRate(analyzeResults([arm("Control", 100, 5), arm("V", 100, 5)])).name).toBe(
      "Control",
    );
  });
});

describe("wizardVerdict", () => {
  it("uses each wizard's own empty and flat copy", () => {
    const none = analyzeResults([arm("Control", 0, 0), arm("Variant A", 0, 0)]);
    expect(wizardVerdict(none, "ab").body).toBe(
      "Results appear here once visitors reach your page. This usually takes a few minutes after launch.",
    );
    expect(wizardVerdict(none, "split").body).toMatch(/your Control page/);

    const flat = analyzeResults([arm("Control", 5000, 150), arm("Variant A", 5000, 155)]);
    expect(wizardVerdict(flat, "ab").title).toBe("No clear winner yet");
    expect(wizardVerdict(flat, "split").body).toBe(
      "None of the variants is clearly better or worse than Control yet. Keep the experiment running to collect more data.",
    );
  });

  it("gates the Split URL banner too", () => {
    const early = analyzeResults([arm("Control", 400, 10), arm("Variant", 400, 40)]);
    expect(wizardVerdict(early, "split").title).toBe("Not enough data to call a winner yet");
  });

  it("says the winner is also ahead of the other variants", () => {
    const a = analyzeResults([
      arm("Control", 5000, 150),
      arm("Variant A", 5000, 230),
      arm("Variant B", 5000, 152),
      arm("Variant C", 5000, 149),
    ]);
    const v = wizardVerdict(a, "ab");
    expect(v.title).toBe("Variant A is likely better than Control");
    expect(v.body).toMatch(
      /^Variant A is converting 53\.3% better than Control, with a .+ chance to beat it\. It’s also likely ahead of every other variant\.$/,
    );
  });
});

describe("result phrases", () => {
  const winning = analyzeResults([arm("Control", 5000, 150), arm("Variant", 5000, 220)]);
  const early = analyzeResults([arm("Control", 1840, 40), arm("Variant", 1820, 43)]);

  it("pause dialog and completed outcome", () => {
    expect(pauseResultLabel(winning)).toBe("Variant likely better");
    expect(pauseResultLabel(early)).toBe("Not enough data yet");
    expect(completedOutcomeSentence(winning)).toMatch(
      /^Variant won with a .+ chance to beat Control\.$/,
    );
    expect(completedOutcomeSentence(early)).toBe(
      "It ended before there was enough data for a result.",
    );
  });

  it("conversions still needed is the furthest-behind arm (design: 40/43 → about 60)", () => {
    expect(conversionsStillNeeded(early.arms)).toBe(60);
    expect(conversionsStillNeeded(winning.arms)).toBe(0);
  });

  it("progress bars cap at full", () => {
    expect(armProgress(arm("Control", 1840, 40))).toEqual({
      visitorsLabel: "1,840 / 1,000",
      visitorsFraction: 1,
      visitorsMet: true,
      conversionsLabel: "40 / 100",
      conversionsFraction: 0.4,
      conversionsMet: false,
    });
  });
});

describe("resultNote", () => {
  const none = analyzeResults([arm("Control", 0, 0), arm("Variant", 0, 0)]);
  const early = analyzeResults([arm("Control", 1840, 40), arm("Variant", 1820, 43)]);
  const up = analyzeResults([arm("Control", 6200, 216), arm("Variant", 6280, 257)]);
  const down = analyzeResults([arm("Control", 5000, 135), arm("Variant", 5000, 125)]);
  const flat = analyzeResults([arm("Control", 5000, 150), arm("Variant", 5000, 155)]);
  const lose = analyzeResults([arm("Control", 5000, 200), arm("Variant", 5000, 150)]);

  it("draft and no-data rows differ by surface, as the designs do", () => {
    expect(resultNote(none, "draft", "list")).toBe("");
    expect(resultNote(none, "draft", "project")).toBe("no result yet");
    expect(resultNote(none, "running", "list")).toBe("no data yet");
    expect(resultNote(none, "paused", "project")).toBe("no result yet");
  });

  it("running and paused", () => {
    expect(resultNote(early, "running", "list")).toBe("collecting data");
    expect(resultNote(early, "paused", "list")).toBe("paused before a result");
    expect(resultNote(up, "running", "project")).toBe("+0.6 pts vs control");
    expect(resultNote(down, "paused", "list")).toBe(`${MINUS}0.2 pts vs control`);
  });

  it("completed", () => {
    expect(resultNote(up, "completed", "list")).toBe("variant won");
    expect(resultNote(lose, "completed", "list")).toBe("control won");
    expect(resultNote(flat, "completed", "list")).toBe("no clear winner");
    expect(resultNote(early, "completed", "list")).toBe("ended before a result");
    const multi = analyzeResults([
      arm("Control", 5000, 150),
      arm("Variant A", 5000, 151),
      arm("Variant B", 5000, 230),
    ]);
    expect(resultNote(multi, "completed", "list")).toBe("Variant B won");
  });

  it("maps the Prisma status enum", () => {
    expect(
      ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"].map((s) => resultStatusOf(s as never)),
    ).toEqual(["draft", "running", "paused", "completed"]);
  });
});

describe("cumulativeSeries", () => {
  const from = new Date("2026-10-01T15:00:00Z");
  const to = new Date("2026-10-04T09:00:00Z");

  it("zero-fills days and accumulates per arm", () => {
    const s = cumulativeSeries(
      [
        { day: "2026-10-01", armKey: null, visitors: 10, conversions: 1 },
        { day: "2026-10-01", armKey: "v1", visitors: 0, conversions: 0 },
        { day: "2026-10-03", armKey: null, visitors: 10, conversions: 3 },
        { day: "2026-10-03", armKey: "v1", visitors: 20, conversions: 2 },
        { day: "2026-10-04", armKey: "v1", visitors: 0, conversions: 1 },
        { day: "2026-09-30", armKey: null, visitors: 999, conversions: 999 }, // before launch
        { day: "2026-10-02", armKey: "unknown", visitors: 5, conversions: 5 }, // not requested
      ],
      [null, "v1"],
      from,
      to,
    );
    expect(s.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(s.arms[0]!.rates).toEqual([0.1, 0.1, 0.2, 0.2]);
    expect(s.arms[0]!.visitors).toEqual([10, 10, 20, 20]);
    expect(s.arms[1]!.rates).toEqual([null, null, 0.1, 0.15]);
    expect(s.arms[1]!.conversions).toEqual([0, 0, 2, 3]);
  });

  it("produces a single day when launched and read the same day", () => {
    const s = cumulativeSeries([], [null], from, from);
    expect(s.days).toEqual(["2026-10-01"]);
    expect(s.arms[0]!.rates).toEqual([null]);
  });

  it("is shown only with data and at least two days", () => {
    expect(showCumulativeChart(true, 2)).toBe(true);
    expect(showCumulativeChart(true, 1)).toBe(false);
    expect(showCumulativeChart(false, 9)).toBe(false);
  });
});

describe("multi-variant winner — must beat the other variants too", () => {
  // Both variants beat Control by a mile, and are a coin toss against each other.
  const tied = analyzeResults([
    arm("Control", 5000, 150),
    arm("Variant A", 5000, 230),
    arm("Variant B", 5000, 232),
  ]);

  it("names no winner when two variants beat Control but not each other", () => {
    expect(tied.enough).toBe(true);
    expect(tied.likelyBetter.map((a) => a.name)).toEqual(["Variant A", "Variant B"]);
    expect(tied.winner).toBeNull();
    expect(recommendedArm(tied)).toBeNull();
  });

  it("says so, on the detail page and in the wizard, without naming a winner", () => {
    for (const v of [
      experimentVerdict(tied, { status: "running" }),
      experimentVerdict(tied, { status: "completed" }),
      wizardVerdict(tied, "split"),
    ]) {
      expect(v.kind).toBe("flat");
      expect(v.title).toBe("Variant A and Variant B are likely better than Control");
      expect(v.body).toMatch(/no single version is clearly best/);
      expect(`${v.title} ${v.body}`).not.toMatch(/\bwon\b|is the winner/);
    }
    expect(resultNote(tied, "completed", "list")).toBe("no clear winner");
  });

  it("names the variant that beats Control and every other variant", () => {
    const clear = analyzeResults([
      arm("Control", 5000, 150),
      arm("Variant A", 5000, 230),
      arm("Variant B", 5000, 160),
    ]);
    expect(clear.winner?.name).toBe("Variant A");
    expect(chanceToBeatControl(clear.arms[2]!, clear.arms[1]!)).toBeGreaterThanOrEqual(WIN_CHANCE);
  });

  it("still names a single variant's winner exactly as before", () => {
    const single = analyzeResults([arm("Control", 5000, 150), arm("Variant", 5000, 220)]);
    expect(single.winner?.name).toBe("Variant");
  });
});

describe("choosing a winner", () => {
  const winning = analyzeResults([arm("Control", 5000, 150), arm("Variant", 5000, 220)]);
  const early = analyzeResults([arm("Control", 300, 9), arm("Variant", 300, 15)]);
  const flat = analyzeResults([arm("Control", 5000, 150), arm("Variant", 5000, 152)]);
  const losing = analyzeResults([arm("Control", 5000, 220), arm("Variant", 5000, 150)]);
  const empty = analyzeResults([arm("Control", 0, 0), arm("Variant", 0, 0)]);

  it("recommends the gated winner, or Control when every variant is likely worse", () => {
    expect(recommendedArm(winning)?.name).toBe("Variant");
    expect(recommendedArm(losing)?.name).toBe("Control");
    expect(recommendedArm(early)).toBeNull();
    expect(recommendedArm(flat)).toBeNull();
    expect(recommendedArm(empty)).toBeNull();
  });

  it("only the recommendation counts as recommended", () => {
    expect(winnerBasis(winning, 1)).toBe("recommended");
    expect(winnerBasis(winning, 0)).toBe("manual");
    expect(winnerBasis(early, 1)).toBe("manual");
    expect(winnerBasis(flat, 1)).toBe("manual");
    expect(winnerBasis(losing, 0)).toBe("recommended");
  });

  it("explains why a manual choice isn't backed by the data", () => {
    expect(manualChoiceCaveat(winning, 1)).toBeNull();
    expect(manualChoiceCaveat(empty, 1)).toMatch(/no data yet/);
    expect(manualChoiceCaveat(early, 1)).toMatch(/Not every version has reached 1,000 visitors/);
    expect(manualChoiceCaveat(flat, 1)).toMatch(/No version is clearly better/);
    expect(manualChoiceCaveat(winning, 0)).toMatch(/The data favours Variant/);
    expect(manualChoiceCaveat(losing, 1)).toMatch(/likely worse than Control/);
  });

  it("calls a recommended choice a win, and a manual one only a choice", () => {
    const won = decisionVerdict(winning, {
      armIndex: 1,
      basis: "recommended",
      chosenBy: "Dana",
      chosenLabel: "Oct 27",
    });
    expect(won.kind).toBe("win");
    expect(won.title).toBe("Variant won");
    expect(won.body).toMatch(/Dana chose it on Oct 27 as the winner, as Routely recommended\.$/);

    const call = decisionVerdict(early, {
      armIndex: 1,
      basis: "manual",
      chosenBy: "Dana",
      chosenLabel: "Oct 27",
    });
    expect(call.kind).toBe("flat");
    expect(call.title).toBe("Variant chosen as the winner");
    expect(call.body).toMatch(/^Dana chose Variant on Oct 27\. Not every version/);
    expect(call.body).toMatch(/not a statistically reliable result\.$/);
    expect(`${call.title} ${call.body}`).not.toMatch(/\bwon\b|likely better|proven/);
  });

  it("names nobody when the reader may not see who chose (the share page)", () => {
    const v = decisionVerdict(flat, {
      armIndex: 0,
      basis: "manual",
      chosenBy: null,
      chosenLabel: "Oct 27",
    });
    expect(v.body).toMatch(/^Control was chosen on Oct 27\./);
  });

  it("badges and notes follow the basis", () => {
    expect(decisionBadge("recommended")).toBe("Winner");
    expect(decisionBadge("manual")).toBe("Chosen");
    expect(resultNote(winning, "completed", "list", { armIndex: 1, basis: "recommended" })).toBe(
      "variant won",
    );
    expect(resultNote(early, "completed", "list", { armIndex: 1, basis: "manual" })).toBe(
      "Variant chosen",
    );
    expect(resultNote(flat, "completed", "project", { armIndex: 0, basis: "manual" })).toBe(
      "control kept",
    );
    expect(resultNote(empty, "completed", "list", { armIndex: 1, basis: "manual" })).toBe(
      "Variant chosen",
    );
  });

  it("reads a stored choice back", () => {
    const at = new Date("2026-10-27T00:00:00Z");
    const ids = ["v1", "v2"];
    expect(
      storedDecision({ winnerChosenAt: null, winnerVariantId: null, winnerBasis: null }, ids),
    ).toBeNull();
    expect(
      storedDecision({ winnerChosenAt: at, winnerVariantId: null, winnerBasis: "MANUAL" }, ids),
    ).toEqual({ armIndex: 0, basis: "manual" });
    expect(
      storedDecision(
        { winnerChosenAt: at, winnerVariantId: "v2", winnerBasis: "RECOMMENDED" },
        ids,
      ),
    ).toEqual({ armIndex: 2, basis: "recommended" });
  });
});
