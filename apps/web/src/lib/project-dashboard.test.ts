import { describe, expect, it } from "vitest";

import { experimentsCaption, rankProjects, sparkPaths } from "./dashboard";
import { checkHeader, checkRows, showTips, verifyFromResult } from "./pixel-check";
import {
  type ExperimentRowInput,
  actionHref,
  dayPoints,
  deriveExperimentRow,
  needAndAction,
  needsAction,
  sortExperimentRows,
} from "./project-dashboard";

const now = new Date("2026-10-19T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

function input(overrides: Partial<ExperimentRowInput>): ExperimentRowInput {
  return {
    id: "exp1",
    name: "Pricing page",
    type: "SPLIT_URL",
    status: "ACTIVE",
    trafficAllocation: 50,
    publishedAt: hoursAgo(48),
    endedAt: null,
    updatedAt: hoursAgo(1),
    arms: [
      { name: "Control", visitors: 100, conversions: 4 },
      { name: "Variant A", visitors: 100, conversions: 6 },
    ],
    setupComplete: false,
    ...overrides,
  };
}

describe("needAndAction", () => {
  it("follows the spec table", () => {
    const at = (status: ExperimentRowInput["status"], visitors: number, h = 48, done = false) =>
      needAndAction({ status, publishedAt: hoursAgo(h), setupComplete: done }, visitors, now);
    expect(at("PAUSED", 10)).toEqual({ need: "Paused", action: "Review" });
    expect(at("ACTIVE", 0, 2)).toEqual({ need: "Awaiting traffic", action: "Review" });
    expect(at("ACTIVE", 0, 24)).toEqual({ need: "No traffic", action: "Review" });
    expect(at("DRAFT", 0, 0, true)).toEqual({ need: "Not launched", action: "Launch" });
    expect(at("DRAFT", 0, 0, false)).toEqual({ need: "Setup incomplete", action: "Continue" });
    expect(at("ACTIVE", 5)).toEqual({ need: null, action: "View results" });
    expect(at("COMPLETED", 0)).toEqual({ need: null, action: "View results" });
  });

  it("counts the same experiments as needing action on the Dashboard", () => {
    expect(needsAction("DRAFT", false)).toBe(true);
    expect(needsAction("PAUSED", true)).toBe(true);
    expect(needsAction("ACTIVE", false)).toBe(true);
    expect(needsAction("ACTIVE", true)).toBe(false);
    expect(needsAction("COMPLETED", false)).toBe(false);
  });

  it("links each action to its screen", () => {
    expect(actionHref("e1", "ab", "Continue")).toBe("/experiments/new/ab-test?id=e1");
    expect(actionHref("e1", "split", "Continue")).toBe("/experiments/new/split-url?id=e1");
    expect(actionHref("e1", "ab", "Review")).toBe("/experiments/e1?view=review");
    expect(actionHref("e1", "ab", "View results")).toBe("/experiments/e1");
    expect(actionHref("e1", "ab", "Launch")).toBeNull();
  });
});

describe("deriveExperimentRow", () => {
  it("stops a paused experiment's day count at the pause", () => {
    const paused = { status: "PAUSED" as const, publishedAt: hoursAgo(24 * 11 + 1) };
    expect(deriveExperimentRow(input({ ...paused, pausedAt: hoursAgo(24 * 3) }), now).row.day).toBe(
      9,
    );
    expect(deriveExperimentRow(input(paused), now).row.day).toBe(12);
  });

  it("computes visitors, pooled rate, arms, share and the day", () => {
    const { row } = deriveExperimentRow(input({}), now);
    expect(row).toMatchObject({
      type: "split",
      status: "running",
      visitors: 200,
      conversions: 10,
      variants: 2,
      share: 50,
      day: 3,
      note: "collecting data",
      need: null,
      action: "View results",
      href: "/experiments/exp1",
    });
    expect(row.rate).toBeCloseTo(5);
  });

  it("shows 0% share unless running, an end date when completed, and 'just now' after launch", () => {
    expect(deriveExperimentRow(input({ status: "PAUSED" }), now).row.share).toBe(0);
    const done = deriveExperimentRow(
      input({ status: "COMPLETED", endedAt: new Date("2026-09-18T10:00:00Z") }),
      now,
    ).row;
    expect(done.ended).toBe("Sep 18");
    expect(done.note).toBe("ended before a result");
    const fresh = deriveExperimentRow(
      input({
        publishedAt: new Date(now.getTime() - 20_000),
        arms: [
          { name: "Control", visitors: 0, conversions: 0 },
          { name: "Variant A", visitors: 0, conversions: 0 },
        ],
      }),
      now,
    ).row;
    expect(fresh).toMatchObject({ justLaunched: true, need: "Awaiting traffic", rate: null });
  });

  it("uses the gated note: points vs control only once every arm has enough", () => {
    const row = deriveExperimentRow(
      input({
        arms: [
          { name: "Control", visitors: 5000, conversions: 200 },
          { name: "Variant A", visitors: 5000, conversions: 230 },
        ],
      }),
      now,
    ).row;
    expect(row.note).toBe("+0.6 pts vs control");
  });

  it("names drafts and carries the launch facts only for a ready draft", () => {
    const launch = {
      page: "acme.com/cart",
      include: 100,
      targeting: "All visitors",
      goal: "acme.com/thanks",
      arms: [] as [string, string, string][],
      changes: "x",
    };
    const ready = deriveExperimentRow(
      input({ status: "DRAFT", name: "", publishedAt: null, setupComplete: true, launch }),
      now,
    ).row;
    expect(ready).toMatchObject({ name: "Untitled experiment", action: "Launch", href: null });
    expect(ready.launch).toEqual(launch);
    expect(ready.note).toBe("no result yet");
  });
});

describe("sortExperimentRows", () => {
  it("puts needs-action first, then running by launch, completed by end, drafts by edit", () => {
    const rows = [
      input({ id: "done-old", status: "COMPLETED", endedAt: hoursAgo(300) }),
      input({ id: "run-old", publishedAt: hoursAgo(200) }),
      input({ id: "draft", status: "DRAFT", setupComplete: false, publishedAt: null }),
      input({ id: "paused", status: "PAUSED" }),
      input({ id: "done-new", status: "COMPLETED", endedAt: hoursAgo(10) }),
      input({ id: "run-new", publishedAt: hoursAgo(50) }),
      input({ id: "ready", status: "DRAFT", setupComplete: true, publishedAt: null }),
    ].map((r) => deriveExperimentRow(r, now));
    expect(sortExperimentRows(rows).map((r) => r.id)).toEqual([
      "paused",
      "ready",
      "draft",
      "run-new",
      "run-old",
      "done-new",
      "done-old",
    ]);
  });
});

describe("dayPoints", () => {
  it("keeps the UTC day as written whatever the viewer's zone", () => {
    const [p] = dayPoints([{ day: "2026-10-13", v: 5 }]);
    expect([p!.d.getFullYear(), p!.d.getMonth(), p!.d.getDate(), p!.v]).toEqual([2026, 9, 13, 5]);
  });
});

describe("dashboard helpers", () => {
  it("ranks by running, then experiments, keeping input order on ties", () => {
    const rows = [
      { id: "a", running: 0, experiments: 0 },
      { id: "b", running: 2, experiments: 3 },
      { id: "c", running: 6, experiments: 14 },
      { id: "d", running: 2, experiments: 5 },
      { id: "e", running: 0, experiments: 0 },
    ];
    expect(rankProjects(rows).map((r) => r.id)).toEqual(["c", "d", "b", "a", "e"]);
  });

  it("captions the experiments card", () => {
    const e = { total: 0, drafts: 0, paused: 0, completed: 0, running: 0 };
    expect(experimentsCaption(e)).toBe("None created yet");
    expect(experimentsCaption({ ...e, total: 2, running: 2 })).toBe("All running");
    expect(experimentsCaption({ ...e, total: 9, drafts: 1, paused: 2, completed: 5 })).toBe(
      "1 draft · 2 paused · 5 completed",
    );
  });

  it("draws 30 sparkline points from 34 days, and a mid line when flat", () => {
    const { line } = sparkPaths(Array.from({ length: 34 }, (_, i) => i));
    expect(line.split(" L")).toHaveLength(30);
    const flat = sparkPaths(Array(34).fill(7)).line;
    expect(
      new Set(
        flat
          .slice(1)
          .split(" L")
          .map((pt) => pt.split(" ")[1]),
      ),
    ).toEqual(new Set(["9.0"]));
  });
});

describe("pixel check rows", () => {
  const ctx = { shortUrl: "acme.com/" };
  const base = {
    pageLoaded: true,
    loadError: null,
    scriptFound: true,
    antiFlickerFound: true,
    wrongSiteId: false,
    lastSeenAt: null,
  };

  it("shows two rows — the page and the script — and no events row", () => {
    expect(checkRows("idle", null, ctx).map((r) => r.title)).toEqual([
      "Page loads",
      "Script found",
    ]);
    const rows = checkRows("found", { ...base, lastSeenAt: hoursAgo(2).toISOString() }, ctx);
    expect(rows.map((r) => [r.title, r.tone])).toEqual([
      ["Page loaded", "ok"],
      ["Pixel found", "ok"],
    ]);
  });

  it("words a missing script, another project's script and a page that didn't load", () => {
    const missing = { ...base, scriptFound: false, antiFlickerFound: false };
    expect(verifyFromResult(missing)).toBe("missing");
    expect(checkRows("missing", missing, ctx)[1]!.title).toBe("Pixel not found");
    expect(checkRows("missing", { ...missing, wrongSiteId: true }, ctx)[1]!.title).toBe(
      "Different Project ID",
    );
    const down = { ...missing, pageLoaded: false, loadError: "acme.com returned HTTP 500." };
    expect(checkRows("missing", down, ctx)[0]).toMatchObject({
      title: "Page didn’t load",
      text: "acme.com returned HTTP 500.",
      tone: "fail",
    });
    expect(checkHeader("missing", down, { shortUrl: "acme.com/", domain: "acme.com" }).title).toBe(
      "We couldn’t load acme.com/",
    );
    expect(showTips("missing", missing)).toBe(true);
    expect(showTips("missing", down)).toBe(false);
  });
});
