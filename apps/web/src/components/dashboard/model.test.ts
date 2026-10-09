import { describe, expect, it } from "vitest";

import { csvCell, exportFileName, overviewCsv, type ExportRow } from "./export-csv";
import { buildDashboard, initialsOf, type DashboardContext } from "./model";
import type { DashboardData, ExperimentListItem, MetricRow } from "@/lib/view-models";

const NOW = new Date("2026-10-09T12:00:00Z");

function exp(
  id: string,
  over: Partial<ExperimentListItem> & { v?: [number, number]; c?: [number, number] } = {},
): ExperimentListItem {
  const { v = [0, 0], c = [0, 0], ...rest } = over;
  const status = rest.status ?? "running";
  return {
    id,
    projectId: "p1",
    name: `Experiment ${id}`,
    type: "ab",
    status,
    displayStatus: status,
    url: "https://acme.com/",
    path: "/",
    hypothesis: "",
    coverage: 100,
    arms: [
      {
        position: 0,
        variantId: null,
        name: "Control",
        color: "#7C879C",
        url: "",
        weight: 50,
        changes: [],
      },
      {
        position: 1,
        variantId: "v1",
        name: "Variant A",
        color: "#2B59F0",
        url: "",
        weight: 50,
        changes: [],
      },
    ],
    goal: null,
    counting: "unique",
    winnerPosition: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    publishedAt: null,
    stoppedAt: null,
    daysRunning: 5,
    totals: [
      { position: 0, v: v[0], c: c[0] },
      { position: 1, v: v[1], c: c[1] },
    ],
    visitors: v[0] + v[1],
    conversions: c[0] + c[1],
    ...rest,
  };
}

function data(experiments: ExperimentListItem[], over: Partial<DashboardData> = {}): DashboardData {
  // Sep 26 … Oct 9
  const days = Array.from({ length: 14 }, (_, i) =>
    new Date(Date.UTC(2026, 8, 26 + i)).toISOString().slice(0, 10),
  );
  return {
    timezone: "UTC",
    days,
    daily: days.map(() => ({ v: 0, c: 0 })),
    uniqueVisitors: 0,
    experiments,
    silentMetrics: [],
    activity: [],
    sheetsConnected: false,
    ...over,
  };
}

const ctx: DashboardContext = {
  projectId: "p1",
  domain: "acme.com",
  installed: true,
  threshold: 0.95,
  draftIncomplete: {},
  actorName: "Dana Whitfield",
  now: NOW,
};

describe("buildDashboard — needs action", () => {
  it("follows the design's order and labels", () => {
    const view = buildDashboard(
      data([
        exp("winning", { v: [5000, 5000], c: [250, 400] }),
        exp("quiet"),
        exp("paused", { status: "paused" }),
        exp("draft", { status: "draft", daysRunning: 0 }),
        exp("ready", { status: "draft", daysRunning: 0 }),
        exp("flat", { v: [100, 100], c: [5, 5] }),
        exp("done", { status: "completed", stoppedAt: "2026-10-03T10:00:00Z" }),
      ]),
      { ...ctx, draftIncomplete: { draft: 2, ready: 0 } },
    );
    const by = Object.fromEntries(view.rows.map((r) => [r.id, r]));
    expect([by.winning!.na, by.winning!.naSub]).toEqual(["Ready to call", "Winner found"]);
    expect([by.quiet!.na, by.quiet!.naSub]).toEqual(["No traffic", "Check targeting"]);
    expect([by.paused!.na, by.paused!.naSub]).toEqual(["Paused", "Visitors see Control"]);
    expect([by.draft!.na, by.draft!.naSub]).toEqual(["Setup incomplete", "2 steps left"]);
    expect([by.ready!.na, by.ready!.naSub]).toEqual(["Ready to launch", "Run QA and launch"]);
    expect([by.flat!.na, by.flat!.naSub, by.flat!.needsAction]).toEqual(["—", "On track", false]);
    expect(by.done!.when).toBe("ended Oct 3");
    expect(by.done!.action).toEqual({ label: "Results", href: "/p/p1/experiments/done" });
    expect(by.draft!.action).toEqual({ label: "Continue", href: "/p/p1/experiments/draft/edit" });
    expect(by.winning!.primary).toBe(true);
    expect(by.flat!.primary).toBe(false);
    expect(view.counts).toEqual({ all: 7, running: 3, needs: 5 });
    expect(view.sub).toBe("Last 14 days · 1 ready to call");
  });

  it("offers Install when the snippet is missing, before any other running reason", () => {
    const view = buildDashboard(data([exp("a", { v: [10, 10], c: [1, 1] })]), {
      ...ctx,
      installed: false,
    });
    expect(view.rows[0]!.na).toBe("Tracking not installed");
    expect(view.rows[0]!.action).toEqual({ label: "Install", install: true });
    expect(view.tracking).toEqual({
      live: false,
      label: "Script not seen",
      sub: "Install on acme.com",
    });
    expect(view.integrations[0]!.status).toEqual({ text: "Not installed", color: "#B4361F" });
  });

  it("sends a silent goal to the GTM tab", () => {
    const metric = { id: "m1", key: "demo_booked" } as MetricRow;
    const view = buildDashboard(
      data(
        [
          exp("a", {
            goal: {
              mode: "event",
              key: "m1",
              metricId: "m1",
              name: "Demo booked",
              eventKey: "demo_booked",
              url: null,
              match: "exact",
            },
          }),
        ],
        { silentMetrics: [metric] },
      ),
      ctx,
    );
    expect([view.rows[0]!.na, view.rows[0]!.naSub]).toEqual([
      "Goal never fired",
      "demo_booked not received",
    ]);
    expect(view.rows[0]!.action).toEqual({
      label: "Fix goal",
      href: "/p/p1/metrics?tab=gtm&metric=m1",
    });
  });

  it("sorts needs-action first, then running · paused · draft · completed, newest first", () => {
    const view = buildDashboard(
      data([
        exp("done", { status: "completed" }),
        exp("old", { v: [100, 100], c: [5, 5], updatedAt: "2026-09-01T00:00:00Z" }),
        exp("new", { v: [100, 100], c: [5, 5], updatedAt: "2026-10-05T00:00:00Z" }),
        exp("paused", { status: "paused" }),
      ]),
      ctx,
    );
    expect(view.rows.map((r) => r.id)).toEqual(["paused", "new", "old", "done"]);
  });
});

describe("buildDashboard — cards", () => {
  it("shares traffic among running and paused experiments only", () => {
    const view = buildDashboard(
      data([
        exp("a", { v: [300, 300], c: [10, 20] }),
        exp("b", { status: "paused", v: [200, 200], c: [5, 5] }),
        exp("c", { status: "completed", v: [1000, 1000], c: [1, 1] }),
      ]),
      ctx,
    );
    const share = Object.fromEntries(view.rows.map((r) => [r.id, r.share]));
    expect(share).toEqual({ a: "60%", b: "40%", c: "0%" });
    expect(view.rows.find((r) => r.id === "a")!.cr).toBe("6.67%");
    expect(view.rows.find((r) => r.id === "a")!.crSub).toBe("+100.0% vs control");
  });

  it("totals conversions of running experiments with data", () => {
    const view = buildDashboard(
      data([
        exp("a", { v: [500, 500], c: [20, 30] }),
        exp("b", { v: [500, 500], c: [5, 5] }),
        exp("quiet"),
      ]),
      ctx,
    );
    expect(view.conversions.total).toBe("60");
    expect(view.conversions.sub).toBe("3.00% conversion rate across 2 running experiments");
    expect(view.conversions.bars.map((b) => [b.id, b.width])).toEqual([
      ["a", "100%"],
      ["b", "20%"],
    ]);
    expect(buildDashboard(data([exp("quiet")]), ctx).conversions.bars).toEqual([]);
  });

  it("compares the last 7 days of visitors with the 7 before", () => {
    const daily = Array.from({ length: 14 }, (_, i) => ({ v: i < 7 ? 10 : 15, c: 1 }));
    const view = buildDashboard(data([exp("a")], { daily, uniqueVisitors: 170 }), ctx);
    expect(view.visitors.total).toBe("170");
    expect(view.visitors.delta).toBe("▲ 50.0%");
    expect(view.visitors.avg).toBe("13");
    expect(view.visitors.bars).toHaveLength(14);
    expect(view.visitors.bars[13]!.today).toBe(true);
    expect(view.visitors.bars[0]!.label).toBe("");
    expect(view.visitors.bars[1]!.label).toBe("27");
    expect(view.visitors.bars[13]!.tip).toBe("Oct 9 · 15 visitors · 1 conversions");
    expect(buildDashboard(data([exp("a")]), ctx).visitors).toMatchObject({ has: false, delta: "" });
  });

  it("shows the signed-in user as You and opens drafts in the wizard", () => {
    const view = buildDashboard(
      data([exp("d", { status: "draft", name: "Webinar" }), exp("r", { name: "Pricing" })], {
        activity: [
          {
            id: "1",
            experimentId: "d",
            text: "Experiment created as draft",
            actorName: "Dana Whitfield",
            createdAt: "2026-10-09T08:00:00Z",
          },
          {
            id: "2",
            experimentId: "r",
            text: "Experiment paused",
            actorName: "Marcus Lee",
            createdAt: "2026-10-07T08:00:00Z",
          },
          {
            id: "3",
            experimentId: "gone",
            text: "Deleted",
            actorName: null,
            createdAt: "2026-10-07T08:00:00Z",
          },
        ],
      }),
      ctx,
    );
    expect(view.feed).toHaveLength(2);
    expect(view.feed[0]).toMatchObject({
      who: "You",
      initials: "DW",
      text: "experiment created as draft",
      when: "Today",
      href: "/p/p1/experiments/d/edit",
    });
    expect(view.feed[1]).toMatchObject({ who: "Marcus Lee", initials: "ML", when: "Oct 7" });
  });

  it("claims Sheets only when it really exports, and never a CDN status", () => {
    const off = buildDashboard(data([exp("a")]), ctx).integrations;
    const on = buildDashboard(data([exp("a")], { sheetsConnected: true }), ctx).integrations;
    expect(off.find((i) => i.key === "sheets")!.status).toBeNull();
    expect(on.find((i) => i.key === "sheets")!.status).toEqual({
      text: "Connected",
      color: "#0F7A52",
    });
    expect(on.find((i) => i.key === "cdn")!.status).toBeNull();
  });
});

describe("initialsOf", () => {
  it("takes two words, or splits an email", () => {
    expect(initialsOf("Marcus Lee")).toBe("ML");
    expect(initialsOf("dev@routely.local")).toBe("DR");
    expect(initialsOf("")).toBe("?");
  });
});

describe("overview CSV", () => {
  const row: ExportRow = {
    name: 'Checkout, "v2"',
    type: "A/B test",
    status: "Running",
    visitors: 1200,
    conversions: 60,
    conversionRate: 0.05,
    bestVariantRate: 0.0612,
    lift: -0.00001,
    needsAction: "Ready to call — Winner found",
  };

  it("writes a header and one quoted row per experiment", () => {
    const csv = overviewCsv([
      row,
      {
        ...row,
        name: "Blog",
        conversionRate: null,
        bestVariantRate: null,
        lift: 0.214,
        needsAction: "",
      },
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Experiment,Type,Status,Visitors,Conversions,Conversion rate,Best variant conversion rate,Lift vs control (best variant),Needs action",
    );
    expect(lines[1]).toBe(
      '"Checkout, ""v2""",A/B test,Running,1200,60,5.00%,6.12%,0.0%,Ready to call — Winner found',
    );
    expect(lines[2]).toBe("Blog,A/B test,Running,1200,60,,,+21.4%,");
  });

  it("keeps formula-shaped names as text", () => {
    expect(csvCell('=HYPERLINK("http://evil")', true)).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("-5", false)).toBe("-5");
  });

  it("names the file after the project and the day", () => {
    expect(exportFileName("Kestrel HQ!", new Date(2026, 9, 9))).toBe(
      "routely-overview-kestrel-hq-2026-10-09.csv",
    );
  });
});
