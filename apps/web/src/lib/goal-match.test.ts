import { describe, expect, it } from "vitest";

import {
  type GoalExperiment,
  type MetricDef,
  goalKeys,
  goalsMet,
  metricsHit,
} from "@/lib/goal-match";

const GOAL = "https://acme.test/thank-you";

const METRICS: MetricDef[] = [
  { id: "m_pv", kind: "PAGE_VISIT", key: "page_view", url: null, matchType: "EXACT", system: true },
  {
    id: "m_signup",
    kind: "CUSTOM_EVENT",
    key: "signup",
    url: null,
    matchType: "EXACT",
    system: false,
  },
  {
    id: "m_order",
    kind: "PAGE_VISIT",
    key: "page_view_order",
    url: "https://acme.test/order",
    matchType: "PREFIX",
    system: false,
  },
];

const urlGoal: GoalExperiment = {
  goalMetricId: null,
  conversionUrl: GOAL,
  conversionMatchType: "EXACT",
  secondaryMetricIds: [],
};

const page = (url: string) => ({ type: "page" as const, url });
const ids = (metrics: MetricDef[]) => new Set(metrics.map((m) => m.id));

describe("metricsHit", () => {
  it("counts every page view for the system metric", () => {
    expect(metricsHit(page("https://acme.test/anything"), METRICS).map((m) => m.id)).toEqual([
      "m_pv",
    ]);
  });

  it("matches page-visit metrics by normalised URL, PREFIX with a path boundary", () => {
    expect(
      metricsHit(page("https://acme.test/order/123?utm_source=x"), METRICS).map((m) => m.id),
    ).toEqual(["m_pv", "m_order"]);
    expect(metricsHit(page("https://acme.test/orders"), METRICS).map((m) => m.id)).toEqual([
      "m_pv",
    ]);
  });

  it("matches custom events by exact key, never page metrics", () => {
    expect(metricsHit({ type: "track", key: "signup" }, METRICS).map((m) => m.id)).toEqual([
      "m_signup",
    ]);
    expect(metricsHit({ type: "track", key: "Signup" }, METRICS)).toEqual([]);
    expect(metricsHit({ type: "track", key: "page_view" }, METRICS)).toEqual([]);
  });
});

describe("goalKeys", () => {
  it("lists the primary goal then the secondaries, once each", () => {
    expect(goalKeys(urlGoal)).toEqual(["url"]);
    expect(
      goalKeys({ ...urlGoal, goalMetricId: "m_signup", secondaryMetricIds: ["m_pv", "m_signup"] }),
    ).toEqual(["m_signup", "m_pv"]);
    expect(goalKeys({ ...urlGoal, conversionUrl: null })).toEqual([]);
  });
});

// The URL-goal cases below moved here from the SDK's former `conversion.test.ts`: v4 derives
// conversions on the server, so this is now where URL goal matching lives.
describe("goalsMet", () => {
  const met = (experiment: GoalExperiment, url: string) =>
    goalsMet(experiment, page(url), ids(metricsHit(page(url), METRICS)));

  it("meets the URL goal on the conversion page", () => {
    expect(met(urlGoal, GOAL)).toEqual(["url"]);
  });

  it("matches despite trailing slashes, fragments and campaign parameters", () => {
    expect(met(urlGoal, `${GOAL}/?utm_source=email#top`)).toEqual(["url"]);
  });

  it("does not match an unrelated page", () => {
    expect(met(urlGoal, "https://acme.test/about")).toEqual([]);
  });

  it("honours PREFIX goals without capturing a similarly-named page", () => {
    const prefix = {
      ...urlGoal,
      conversionUrl: "https://acme.test/order",
      conversionMatchType: "PREFIX" as const,
    };
    expect(met(prefix, "https://acme.test/order/123")).toEqual(["url"]);
    expect(met(prefix, "https://acme.test/orders")).toEqual([]);
  });

  it("ignores the stored conversion URL once the primary goal is a metric", () => {
    expect(met({ ...urlGoal, goalMetricId: "m_signup" }, GOAL)).toEqual([]);
  });

  it("meets metric goals — primary and secondary — from the metrics an event hit", () => {
    const experiment = {
      ...urlGoal,
      goalMetricId: "m_signup",
      secondaryMetricIds: ["m_order", "m_pv"],
    };
    const track = { type: "track" as const, key: "signup" };
    expect(goalsMet(experiment, track, ids(metricsHit(track, METRICS)))).toEqual(["m_signup"]);
    expect(met(experiment, "https://acme.test/order/9")).toEqual(["m_order", "m_pv"]);
  });

  it("never meets the URL goal from a custom event", () => {
    expect(goalsMet(urlGoal, { type: "track", key: "signup" }, new Set(["m_signup"]))).toEqual([]);
  });
});
