import { describe, expect, it } from "vitest";

import {
  type ArmInput,
  type ResultsInput,
  type ReviewInput,
  buildExperimentModel,
  buildResultsModel,
  chartHover,
  joinAnd,
  urlPath,
} from "@/lib/experiment-model";
import { NOT_PROOF_NOTE, chanceToBeatControl, formatChance } from "@/lib/verdict";

const NOW = "2026-10-12T12:00:00.000Z";

function arm(
  name: string,
  visitors: number,
  conversions: number,
  extra: Partial<ArmInput> = {},
): ArmInput {
  const isControl = name === "Control";
  return {
    key: isControl ? null : `v-${name}`,
    name,
    colorIndex: isControl ? 0 : 1,
    pct: 50,
    url: null,
    lines: [isControl ? "Original page, unchanged" : `Heading: “${name}”`],
    changeCount: isControl ? 0 : 1,
    visitors,
    conversions,
    ...extra,
  };
}

function input(overrides: Partial<ResultsInput> = {}): ResultsInput {
  const arms = overrides.arms ?? [arm("Control", 0, 0), arm("Variant A", 0, 0)];
  return {
    id: "exp1",
    name: "Homepage hero headline",
    type: "ab",
    status: "running",
    controlUrl: "https://fernwoodsupply.com/",
    goalUrl: "https://fernwoodsupply.com/collections/all",
    include: 50,
    publishedAt: "2026-09-22T09:00:00.000Z",
    pausedAt: null,
    endedAt: null,
    resumedAt: null,
    now: NOW,
    arms,
    series: { days: [], visitors: arms.map(() => []), conversions: arms.map(() => []) },
    decision: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    domain: "fernwoodsupply.com",
    devices: [],
    createdAt: "2026-09-20T10:00:00.000Z",
    createdByName: "Alex Morgan",
    lastSeenAt: "2026-10-12T11:56:00.000Z",
    pixelVerifiedAt: null,
    urlChecks: [],
    activity: [],
    ...overrides,
  };
}

describe("verdict at the gate edges", () => {
  it("collects with no visitors, and shows the configured split", () => {
    const m = buildResultsModel(input());
    expect(m.verdict.kind).toBe("collect");
    expect(m.verdict.title).toBe("Collecting data");
    expect(m.tiles[0]).toMatchObject({ value: "0", sub: "None yet" });
    expect(m.tiles[2]!.value).toBe("—");
    expect(m.rows.map((r) => r.share)).toEqual(["50%", "50%"]);
    expect(m.rows.map((r) => r.rate)).toEqual(["—", "—"]);
    expect(m.notProof).toBeNull();
    expect(m.chart.ok).toBe(false);
    expect(m.distCaption).toBe("Configured split · no visitors yet");
  });

  it("waits at 999 visitors in one arm, however large the difference", () => {
    const m = buildResultsModel(
      input({ arms: [arm("Control", 999, 100), arm("Variant A", 1000, 180)] }),
    );
    expect(m.verdict.kind).toBe("wait");
    expect(m.verdict.title).toBe("Not enough data to call a winner yet");
    expect(m.rows[1]!.isBest).toBe(false);
    expect(m.verdict.progress[0]).toMatchObject({
      vis: "999 / 1,000",
      visW: "99.9%",
      visFill: "#0070C9",
      conv: "100 / 100",
      convFill: "#16A34A",
    });
    expect(m.notProof).toBe(NOT_PROOF_NOTE);
  });

  it("waits at 99 conversions in one arm", () => {
    const m = buildResultsModel(
      input({ arms: [arm("Control", 1000, 99), arm("Variant A", 1000, 180)] }),
    );
    expect(m.verdict.kind).toBe("wait");
    expect(m.verdict.progress[0]!.conv).toBe("99 / 100");
  });

  it("names a likely winner at exactly 1,000 and 100", () => {
    const m = buildResultsModel(
      input({ arms: [arm("Control", 1000, 100), arm("Variant A", 1000, 150)] }),
    );
    const chance = chanceToBeatControl(
      { visitors: 1000, conversions: 100 },
      { visitors: 1000, conversions: 150 },
    );
    expect(chance).toBeGreaterThan(0.95);
    expect(m.verdict.kind).toBe("win");
    expect(m.verdict.title).toBe("Variant A is likely better than Control");
    expect(m.verdict.body).toBe(
      `Variant A converts 50.0% better than Control (15.00% vs 10.00%), with a ${formatChance(chance)} chance to beat it. Every version has passed 1,000 visitors and 100 conversions, so you can end the test and update your site to Variant A.`,
    );
    expect(m.rows[1]).toMatchObject({
      isBest: true,
      bestLabel: "Likely winner",
      lift: "+50.0%",
      liftFg: "#166534",
      chance: formatChance(chance),
      chanceFg: "#166534",
      rate: "15.00%",
      share: "50.0%",
    });
    expect(m.rows[0]).toMatchObject({ lift: "Baseline", chance: "—" });
    expect(m.tiles.map((t) => t.value)).toEqual(["2,000", "250", "12.50%", "50%"]);
  });

  it("says the winner won once completed, with the run's dates", () => {
    const m = buildResultsModel(
      input({
        status: "completed",
        publishedAt: "2026-08-20T09:00:00.000Z",
        endedAt: "2026-09-18T17:45:00.000Z",
        arms: [arm("Control", 10650, 298), arm("Variant", 10656, 362)],
      }),
    );
    expect(m.verdict.title).toBe("Variant won");
    expect(m.verdict.body.startsWith("Ended Sep 18 after 30 days. Variant converts")).toBe(true);
    expect(m.rows[1]!.bestLabel).toBe("Winner");
    expect(m.header.sub).toBe("A/B Testing · fernwoodsupply.com · Ran Aug 20 – Sep 18 (30 days)");
    expect(m.header.canEnd).toBe(false);
  });

  it("calls Control the likely winner when every variant is ≤ 5%", () => {
    const m = buildResultsModel(
      input({ arms: [arm("Control", 1000, 150), arm("Variant A", 1000, 100)] }),
    );
    expect(m.verdict.title).toBe("Control is likely better");
    expect(m.verdict.body).toBe(
      "No variant beats Control. Every version has enough data, and Control converts at 15.00%.",
    );
    expect(m.rows[1]!.liftFg).toBe("#B91C1C");
  });

  it("reports no clear winner when the difference is small", () => {
    const flat = [arm("Control", 1000, 100), arm("Variant A", 1000, 102)];
    expect(buildResultsModel(input({ arms: flat })).verdict.title).toBe("No clear winner yet");
    const done = buildResultsModel(
      input({ arms: flat, status: "completed", endedAt: "2026-10-10T10:00:00.000Z" }),
    );
    expect(done.verdict.title).toBe("No clear winner");
    expect(done.verdict.kind).toBe("flat");
  });

  it("ended before a result names the leader by rate", () => {
    const m = buildResultsModel(
      input({
        status: "completed",
        endedAt: "2026-10-01T10:00:00.000Z",
        arms: [arm("Control", 3105, 68), arm("Variant A", 3105, 44)],
      }),
    );
    expect(m.verdict.title).toBe("Ended before a result");
    expect(m.verdict.body).toContain("Control was ahead at 2.19%");
  });
});

describe("header timing", () => {
  it("running: since the launch day, day N", () => {
    expect(buildResultsModel(input()).header.sub).toBe(
      "A/B Testing · fernwoodsupply.com · Running since Sep 22 · day 21",
    );
  });

  it("split URL shows the two paths", () => {
    const m = buildResultsModel(
      input({
        type: "split",
        controlUrl: "https://fernwoodsupply.com/pricing",
        arms: [
          arm("Control", 0, 0),
          arm("Variant", 0, 0, { url: "https://fernwoodsupply.com/pricing-b" }),
        ],
      }),
    );
    expect(m.header.sub.startsWith("Split URL · /pricing → /pricing-b · ")).toBe(true);
  });

  it("paused: the pause date and the day it was paused on", () => {
    const m = buildResultsModel(input({ status: "paused", pausedAt: "2026-10-10T16:20:00.000Z" }));
    expect(m.header.sub.endsWith("Paused Oct 10 after 19 days")).toBe(true);
    expect(m.header).toMatchObject({ canPause: false, canResume: true, canEnd: true });
  });

  it("just now: launched, paused, resumed", () => {
    const now = new Date(NOW).getTime();
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect(buildResultsModel(input({ publishedAt: ago(20) })).header.sub).toContain(
      "Launched just now",
    );
    expect(buildResultsModel(input({ status: "paused", pausedAt: ago(5) })).header.sub).toContain(
      "Paused just now after 21 days",
    );
    expect(buildResultsModel(input({ resumedAt: ago(5) })).header.sub).toContain(
      "Resumed just now · day 21",
    );
  });

  it("labels dates in the viewer's zone", () => {
    const m = buildResultsModel(input({ publishedAt: "2026-09-22T20:00:00.000Z" }), {
      timeZone: "Asia/Dhaka",
    });
    expect(m.header.sub).toContain("Running since Sep 23");
  });
});

describe("cumulative chart", () => {
  it("plots running totals and ends on the table's rate", () => {
    const arms = [arm("Control", 4, 1), arm("Variant A", 2, 1)];
    const m = buildResultsModel(
      input({
        arms,
        series: {
          days: ["2026-10-10", "2026-10-11", "2026-10-12"],
          visitors: [
            [2, 3, 4],
            [0, 0, 2],
          ],
          conversions: [
            [0, 1, 1],
            [0, 0, 1],
          ],
        },
      }),
    );
    expect(m.chart.ok).toBe(true);
    expect(m.chart.rates).toEqual([
      [0, 1 / 3, 0.25],
      [0, 0, 0.5],
    ]);
    expect(m.chart.xTicks.map((t) => t.label)).toEqual(["Oct 10", "Oct 11", "Oct 12"]);
    // 50% at most → steps of 10 up to 60% (lib/chart-axis.ts).
    expect(m.chart.yMaxPct).toBe(60);
    const hover = chartHover(m.chart, 1);
    expect(hover.tipDate).toBe("Oct 11 · day 2");
    expect(hover.tipRows.map((r) => r.value)).toEqual(["33.33%", "0.00%"]);
    expect(chartHover(m.chart, null).hasHover).toBe(false);
  });

  it("needs two days", () => {
    const arms = [arm("Control", 1, 0), arm("Variant A", 1, 0)];
    const m = buildResultsModel(
      input({
        arms,
        series: { days: ["2026-10-12"], visitors: [[1], [1]], conversions: [[0], [0]] },
      }),
    );
    expect(m.chart.ok).toBe(false);
  });
});

describe("review", () => {
  it("paused split test before a result (the design's e1)", () => {
    const now = "2026-10-14T09:00:00.000Z";
    const model = buildExperimentModel(
      input({
        type: "split",
        status: "paused",
        name: "Pricing page layout",
        controlUrl: "https://fernwoodsupply.com/pricing",
        goalUrl: "https://fernwoodsupply.com/checkout",
        include: 40,
        publishedAt: "2026-10-01T08:00:00.000Z",
        pausedAt: "2026-10-10T16:20:00.000Z",
        now,
        arms: [
          arm("Control", 1972, 40, { lines: ["fernwoodsupply.com/pricing"] }),
          arm("Variant", 1968, 43, {
            url: "https://fernwoodsupply.com/pricing-b",
            lines: ["fernwoodsupply.com/pricing-b"],
          }),
        ],
      }),
      review({
        lastSeenAt: "2026-10-14T08:59:00.000Z",
        urlChecks: [
          {
            url: "https://fernwoodsupply.com/pricing",
            role: "control",
            result: "OK",
            pageLoaded: true,
            detail: null,
            checkedAt: now,
          },
          {
            url: "https://fernwoodsupply.com/pricing-b",
            role: "variant",
            result: "OK",
            pageLoaded: true,
            detail: null,
            checkedAt: now,
          },
        ],
        activity: [
          {
            id: "a1",
            type: "CREATED",
            actorName: "Jamie Lee",
            system: false,
            at: "2026-09-29T10:00:00.000Z",
            fields: [],
          },
          {
            id: "a2",
            type: "LAUNCHED",
            actorName: null,
            system: false,
            at: "2026-10-01T08:00:00.000Z",
            fields: [],
          },
          {
            id: "a3",
            type: "PAUSED",
            actorName: "Jamie Lee",
            system: false,
            at: "2026-10-10T16:20:00.000Z",
            fields: [],
          },
        ],
      }),
    );
    const r = model.review!;
    expect(r.health.title).toBe("Paused before a result");
    expect(r.health.text).toBe(
      "Paused on Oct 10 after 10 days. Nothing blocks resuming, but each version still needs about 60 more conversions before Routely can suggest a winner.",
    );
    expect(r.checks.map((c) => c.title)).toEqual([
      "Visitors are being recorded",
      "Both pages are reachable",
      "Traffic split adds up to 100%",
      "Goal page is set",
      "Not enough data for a result",
      "Ready to resume",
    ]);
    expect(r.checks[1]!.text).toBe(
      "fernwoodsupply.com/pricing and /pricing-b loaded normally on the last check.",
    );
    expect(r.checks[4]!.text).toBe(
      "40 and 43 conversions so far. Each version needs at least 1,000 visitors and 100 conversions.",
    );
    expect(r.health.summary).toBe("1 issue · 4 passed");
    expect(r.events).toEqual([
      { key: "a1", label: "Created by Jamie Lee", when: "Sep 29, 2026" },
      { key: "a2", label: "Launched by a former member", when: "Oct 1, 2026 at 8:00 AM" },
      { key: "a3", label: "Paused by Jamie Lee", when: "Oct 10, 2026 at 4:20 PM" },
    ]);
    expect(r.config.caption).toBe("You can change the setup while it’s paused.");
    expect(r.config.rows.map((x) => x.value)).toEqual([
      "Split URL",
      "40% of site visitors",
      "All visitors",
      "Page view · fernwoodsupply.com/checkout",
      "Sep 20, 2026 by Alex Morgan",
    ]);
    expect(r.glance.map((g) => `${g.label}:${g.value}`)).toEqual([
      "Visitors:3,940",
      "Conversions:83",
      "Days running:10",
      "Traffic share:40%",
    ]);
  });

  it("a live test with no visitors leads with tracking", () => {
    const r = buildExperimentModel(
      input({ publishedAt: "2026-10-12T08:05:00.000Z" }),
      review(),
    ).review!;
    expect(r.health.title).toBe("Live — waiting for the first visitors");
    expect(r.health.text).toBe(
      "Launched Oct 12 at 8:05 AM. Tracking is active on fernwoodsupply.com, so visitors should appear as soon as they reach the tested page.",
    );
    expect(r.checks[0]).toMatchObject({
      title: "Tracking is active",
      text: "Routely received an event from fernwoodsupply.com 4 minutes ago.",
    });
    expect(r.checks[1]!.title).toBe("No visitors in the experiment yet");
  });

  it("flags a code that disappeared from a page, with a re-check", () => {
    const r = buildExperimentModel(
      input({ arms: [arm("Control", 10, 1), arm("Variant A", 10, 2)] }),
      review({
        urlChecks: [
          {
            url: "https://fernwoodsupply.com/",
            role: "control",
            result: "MISSING",
            pageLoaded: true,
            detail: "The page loaded, but the Routely code isn’t on it.",
            checkedAt: NOW,
          },
        ],
      }),
    ).review!;
    const code = r.checks.find((c) => c.key === "code")!;
    expect(code).toMatchObject({ tone: "fail", recheck: true });
    expect(r.health).toMatchObject({ tone: "fail", title: "Needs attention" });
  });

  it("running normally with a winner", () => {
    const r = buildExperimentModel(
      input({ arms: [arm("Control", 6240, 218), arm("Variant A", 6240, 300)] }),
      review(),
    ).review!;
    expect(r.health.title).toBe("Running normally");
    expect(r.health.text).toBe(
      "No issues found. Results update as visitors arrive. Variant A is already the likely winner.",
    );
    // Tracking is fine and visitors are flowing, so it is not repeated as a check.
    expect(r.checks.some((c) => c.key === "tracking")).toBe(false);
    expect(r.checks.at(-1)!.title).toBe("Enough data for a result");
  });

  it("falls back to timestamps when there is no activity log", () => {
    const r = buildExperimentModel(
      input({ status: "completed", endedAt: "2026-10-01T18:00:00.000Z" }),
      review(),
    ).review!;
    expect(r.events.map((e) => e.label)).toEqual(["Created", "Launched", "Ended"]);
    expect(r.health.title).toBe("Completed on Oct 1");
  });
});

describe("helpers", () => {
  it("joins lists the design's way", () => {
    expect(joinAnd(["40"])).toBe("40");
    expect(joinAnd(["40", "43"])).toBe("40 and 43");
    expect(joinAnd(["1", "2", "3"])).toBe("1, 2 and 3");
  });

  it("takes a URL's path", () => {
    expect(urlPath("https://www.acme.com/pricing?x=1")).toBe("/pricing?x=1");
    expect(urlPath("https://acme.com")).toBe("/");
  });
});

describe("winner selection", () => {
  const winning = [arm("Control", 5000, 150), arm("Variant A", 5000, 220)];
  const early = [arm("Control", 300, 9), arm("Variant A", 300, 15)];
  const ended = { status: "completed" as const, endedAt: "2026-10-06T09:00:00.000Z" };

  it("offers every version, preselecting only a recommendation", () => {
    const live = buildResultsModel(input({ arms: winning })).winnerChoice;
    expect(live.ending).toBe(true);
    expect(live.recommendedKey).toBe("v-Variant A");
    expect(live.options.map((o) => [o.key, o.recommended, o.caveat === null])).toEqual([
      ["control", false, false],
      ["v-Variant A", true, true],
    ]);
    const unsure = buildResultsModel(input({ arms: early })).winnerChoice;
    expect(unsure.recommendedKey).toBeNull();
    expect(unsure.options.every((o) => o.caveat !== null)).toBe(true);
  });

  it("shows a recommended choice as the winner, with the next step for a Split URL test", () => {
    const m = buildResultsModel(
      input({
        ...ended,
        type: "split",
        controlUrl: "https://acme.com/pricing",
        arms: [
          arm("Control", 5000, 150, { url: "https://acme.com/pricing" }),
          arm("Variant A", 5000, 220, { url: "https://acme.com/pricing-v2" }),
        ],
        decision: {
          armKey: "v-Variant A",
          basis: "recommended",
          chosenBy: "Dana",
          chosenAt: "2026-10-06T09:00:00.000Z",
        },
      }),
    );
    expect(m.verdict.title).toBe("Variant A won");
    expect(m.verdict.nextStep).toMatch(/visitors to acme\.com\/pricing get acme\.com\/pricing-v2/);
    expect(m.rows.map((r) => [r.isBest, r.bestLabel])).toEqual([
      [false, "Winner"],
      [true, "Winner"],
    ]);
    expect(m.winnerChoice.currentKey).toBe("v-Variant A");
    expect(m.winnerChoice.ending).toBe(false);
  });

  it("shows a manual choice as a call, never a win, with an A/B test's changes to make", () => {
    const m = buildResultsModel(
      input({
        ...ended,
        arms: early,
        decision: {
          armKey: "v-Variant A",
          basis: "manual",
          chosenBy: "Dana",
          chosenAt: "2026-10-06T09:00:00.000Z",
        },
      }),
    );
    expect(m.verdict.title).toBe("Variant A chosen as the winner");
    expect(m.verdict.body).toMatch(/not a statistically reliable result/);
    expect(m.verdict.nextStep).toMatch(/^Make Variant A’s changes on fernwoodsupply\.com/);
    expect(m.rows[1]!.bestLabel).toBe("Chosen");
  });

  it("keeping Control needs no change, and a live experiment ignores a stale decision", () => {
    const kept = buildResultsModel(
      input({
        ...ended,
        arms: early,
        decision: { armKey: null, basis: "manual", chosenBy: null, chosenAt: NOW },
      }),
    );
    expect(kept.verdict.nextStep).toMatch(/^Keep your page as it is/);
    expect(kept.rows[0]!.isBest).toBe(true);

    const live = buildResultsModel(
      input({
        arms: winning,
        decision: { armKey: null, basis: "manual", chosenBy: null, chosenAt: NOW },
      }),
    );
    expect(live.verdict.nextStep).toBeNull();
    expect(live.rows[1]!.bestLabel).toBe("Likely winner");
  });
});
