import { describe, expect, it } from "vitest";

import { computeStats, type ArmCounts } from "./stats";
import { STATUS, defaultWinner, displayStatus, verdict } from "./verdict";

const stats = (counts: [number, number][], n = 0) =>
  computeStats(
    counts.map(([v, c], i): ArmCounts => ({
      name: i ? `Variant ${"ABCD"[i - 1]}` : "Control",
      v,
      c,
    })),
    { n },
  );

describe("verdict", () => {
  it("draft is not launched, whatever the data", () => {
    expect(
      verdict(
        "draft",
        null,
        stats([
          [1000, 50],
          [1000, 90],
        ]),
        0.95,
      ),
    ).toEqual({
      kind: "draft",
      title: "Not launched",
      body: "Finish setup and launch to start collecting data.",
      short: "—",
      tone: "neutral",
    });
  });

  it("waits for visitors", () => {
    const v = verdict(
      "running",
      null,
      stats([
        [0, 0],
        [0, 0],
      ]),
      0.95,
    );
    expect(v.kind).toBe("wait");
    expect(v.title).toBe("Waiting for visitors");
    expect(v.short).toBe("Collecting data");
  });

  it("calls a winner past the threshold", () => {
    const v = verdict(
      "running",
      null,
      stats([
        [2000, 100],
        [2000, 90],
        [2000, 130],
        [2000, 105],
        [2000, 99],
      ]),
      0.95,
    );
    expect(v.kind).toBe("win");
    expect(v.title).toBe("Variant B is winning");
    expect(v.body).toBe(
      "We're 98% confident Variant B beats Control. It converts at 6.50% vs 5.00% (+30.0%).",
    );
    expect(v.ready).toBe(true);
    expect(v.leader?.i).toBe(2);
  });

  it("respects a stricter threshold", () => {
    const s = stats([
      [2000, 100],
      [2000, 130],
    ]);
    expect(verdict("running", null, s, 0.95).kind).toBe("win");
    expect(verdict("running", null, s, 0.99).kind).toBe("early");
  });

  it("says control is winning when every variant is clearly worse", () => {
    const v = verdict(
      "running",
      null,
      stats([
        [1000, 50],
        [1000, 30],
      ]),
      0.95,
    );
    expect(v).toMatchObject({
      kind: "control",
      title: "Control is winning",
      body: "Every variant converts worse than the original. Variant A is closest at −40.0%.",
      tone: "bad",
      ready: true,
    });
    expect(v.leader?.i).toBe(0);
  });

  it("estimates how much longer when too early", () => {
    const v = verdict(
      "running",
      null,
      stats([
        [1000, 50],
        [1000, 65],
      ]),
      0.95,
    );
    expect(v.body).toBe(
      "Variant A leads at +30.0%, but we're only 93% confident. About 2,773 more visitors per variant (~3 days) to reach 95%.",
    );
    expect(v.daysLeft).toBe("~3 days");
    expect(v.moreVisitors).toBe(2773);
    expect(v.short).toBe("Variant A leading");
  });

  it("uses the day count for the daily rate", () => {
    const v = verdict(
      "running",
      null,
      stats(
        [
          [1000, 50],
          [1000, 52],
        ],
        10,
      ),
      0.95,
    );
    expect(v.body).toBe(
      "Variant A leads at +4.0%, but we're only 58% confident. About 188,721 more visitors per variant (60+ days) to reach 95%.",
    );
  });

  it("says no leader when the best variant trails", () => {
    const v = verdict(
      "paused",
      null,
      stats([
        [1000, 50],
        [1000, 48],
        [1000, 45],
      ]),
      0.95,
    );
    expect(v.kind).toBe("early");
    expect(v.short).toBe("No leader yet");
    expect(v.body.startsWith("No variant is ahead yet, and we're only ")).toBe(true);
  });

  it("reports completed outcomes from the stored winner", () => {
    const s = stats([
      [1000, 50],
      [1000, 52],
    ]);
    expect(verdict("completed", 0, s, 0.95)).toMatchObject({
      kind: "control",
      title: "Control won",
      body: "No variant beat the original. Variant A came closest at +4.0%.",
    });
    expect(verdict("completed", null, s, 0.95)).toMatchObject({
      kind: "flat",
      title: "No clear winner",
      body: "The difference was too small to call. Variant A ended at +4.0% with 58% confidence.",
      short: "Inconclusive",
    });
    expect(verdict("completed", 1, s, 0.95)).toMatchObject({
      kind: "win",
      title: "Variant A won",
      body: "Variant A converted +4.0% better than Control with 58% confidence.",
      tone: "good",
    });
  });

  it("treats an out-of-range stored winner as no clear winner", () => {
    expect(
      verdict(
        "completed",
        4,
        stats([
          [1000, 50],
          [1000, 52],
        ]),
        0.95,
      ).kind,
    ).toBe("flat");
  });
});

describe("displayStatus / STATUS / defaultWinner", () => {
  it("shows a completed experiment with a variant winner as winner", () => {
    expect(displayStatus("completed", 2)).toBe("winner");
    expect(displayStatus("completed", 0)).toBe("completed");
    expect(displayStatus("completed", null)).toBe("completed");
    expect(displayStatus("running", 1)).toBe("running");
    expect(STATUS.winner.label).toBe("Winner");
    expect(STATUS.running.glyph).toBe("●");
  });

  it("preselects the leader when ending", () => {
    const s = stats([
      [1000, 50],
      [1000, 30],
    ]);
    expect(defaultWinner(verdict("running", null, s, 0.95))).toBe(0);
    expect(
      defaultWinner(
        verdict(
          "running",
          null,
          stats([
            [1000, 50],
            [1000, 65],
          ]),
          0.9,
        ),
      ),
    ).toBe(1);
    expect(
      defaultWinner(
        verdict(
          "running",
          null,
          stats([
            [1000, 50],
            [1000, 52],
          ]),
          0.95,
        ),
      ),
    ).toBe(-1);
  });
});
