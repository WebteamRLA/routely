import { describe, expect, it } from "vitest";

import type { Experiment } from "@/generated/prisma/client";
import { defaultTargeting } from "@/lib/domain";
import {
  armsOf,
  displayStatus,
  draftSourceOf,
  flattenDraftErrors,
  initialsOf,
  onProjectDomain,
  pageRulesOverlap,
  parseChanges,
  primaryGoalKey,
  statusFromKey,
  statusKey,
  urlGoalView,
  type ExperimentWithVariantsRow,
} from "@/server/mappers";

function experiment(overrides: Partial<ExperimentWithVariantsRow> = {}): ExperimentWithVariantsRow {
  return {
    id: "e1",
    websiteId: "p1",
    name: "Test",
    description: null,
    controlUrl: "https://acme.com/pricing",
    controlMatchType: "EXACT",
    conversionName: null,
    conversionUrl: "https://acme.com/thanks",
    conversionMatchType: "PREFIX",
    controlWeight: 50,
    type: "SPLIT_URL",
    targeting: null,
    goalMetricId: null,
    secondaryMetricIds: [],
    countingMode: "UNIQUE",
    winnerPosition: null,
    keepWinner: false,
    status: "DRAFT",
    trafficAllocation: 100,
    primaryMetric: "CONVERSION_RATE",
    shareToken: null,
    sharedAt: null,
    publishedAt: null,
    stoppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [
      { id: "v1", position: 1, url: "https://acme.com/pricing-v2", weight: 50, changes: [] },
    ],
    ...overrides,
  } as Experiment & ExperimentWithVariantsRow;
}

describe("status mapping", () => {
  it("maps database statuses to UI keys and back", () => {
    expect(statusKey("ACTIVE")).toBe("running");
    expect(statusKey("ARCHIVED")).toBe("completed");
    expect(statusFromKey("paused")).toBe("PAUSED");
  });

  it("shows winner only for a completed experiment won by a variant", () => {
    expect(displayStatus("ARCHIVED", 1)).toBe("winner");
    expect(displayStatus("ARCHIVED", 0)).toBe("completed");
    expect(displayStatus("ARCHIVED", null)).toBe("completed");
    expect(displayStatus("ACTIVE", 1)).toBe("running");
  });
});

describe("arms and changes", () => {
  it("puts control first and blanks A/B URLs", () => {
    const ab = experiment({
      type: "AB",
      variants: [
        {
          id: "v2",
          position: 2,
          url: "",
          weight: 25,
          changes: [{ selector: "h1", prop: "text", value: "B" }],
        },
        { id: "v1", position: 1, url: "", weight: 25, changes: [] },
      ],
    });
    const arms = armsOf(ab);
    expect(arms.map((a) => [a.position, a.variantId, a.name, a.url])).toEqual([
      [0, null, "Control", ""],
      [1, "v1", "Variant A", ""],
      [2, "v2", "Variant B", ""],
    ]);
    expect(arms[2]!.changes).toEqual([{ selector: "h1", prop: "text", value: "B" }]);
  });

  it("drops malformed changes", () => {
    expect(
      parseChanges([
        { selector: "h1", prop: "text", value: "ok", el: "headline" },
        { selector: "h1", prop: "html", value: "x" },
        { prop: "text", value: "no selector" },
        "nonsense",
        { selector: "h2", prop: "bg", value: "#fff", el: "nope" },
      ]),
    ).toEqual([
      { selector: "h1", prop: "text", value: "ok", el: "headline" },
      { selector: "h2", prop: "bg", value: "#fff" },
    ]);
    expect(parseChanges(null)).toEqual([]);
  });
});

describe("goals", () => {
  it("keys the primary goal as url or the metric id", () => {
    expect(primaryGoalKey({ goalMetricId: null })).toBe("url");
    expect(primaryGoalKey({ goalMetricId: "m1" })).toBe("m1");
  });

  it("names a URL goal by its path", () => {
    expect(urlGoalView("https://acme.com/thanks?x=1", "PREFIX")).toMatchObject({
      key: "url",
      name: "Reached /thanks?x=1",
      match: "starts",
    });
  });

  it("builds a wizard source", () => {
    const source = draftSourceOf(experiment());
    expect(source).toMatchObject({
      id: "e1",
      projectId: "p1",
      type: "redirect",
      conversionUrl: "https://acme.com/thanks",
      conversionMatch: "starts",
      counting: "unique",
    });
    expect(source.arms.map((a) => a.url)).toEqual([
      "https://acme.com/pricing",
      "https://acme.com/pricing-v2",
    ]);
  });
});

describe("onProjectDomain", () => {
  it("accepts any project domain and its subdomains, dot-anchored", () => {
    const domains = ["acme.com", "acme-shop.io"];
    expect(onProjectDomain("https://www.acme.com/x", domains)).toBe(true);
    expect(onProjectDomain("https://checkout.acme-shop.io/", domains)).toBe(true);
    expect(onProjectDomain("https://evil-acme.com/", domains)).toBe(false);
    expect(onProjectDomain("https://acme.com.evil.test/", domains)).toBe(false);
  });
});

describe("pageRulesOverlap", () => {
  const rule = (url: string, t: Partial<ReturnType<typeof defaultTargeting>> = {}) => ({
    url,
    targeting: { ...defaultTargeting(url), ...t },
  });

  it("compares exact and starts rules precisely", () => {
    expect(pageRulesOverlap(rule("https://a.com/pricing"), rule("https://a.com/pricing/"))).toBe(
      true,
    );
    expect(pageRulesOverlap(rule("https://a.com/pricing"), rule("https://a.com/about"))).toBe(
      false,
    );
    expect(
      pageRulesOverlap(
        rule("https://a.com/", { match: "starts", pattern: "https://a.com/blog" }),
        rule("https://a.com/blog/post"),
      ),
    ).toBe(true);
  });

  it("tests wildcard/contains/regex rules against the other's concrete URLs", () => {
    const wildcard = rule("https://a.com/blog/*", {
      match: "wildcard",
      testUrl: "https://a.com/blog/how-to",
    });
    expect(pageRulesOverlap(wildcard, rule("https://a.com/blog/post"))).toBe(true);
    expect(pageRulesOverlap(wildcard, rule("https://a.com/pricing"))).toBe(false);
    expect(
      pageRulesOverlap(
        rule("https://a.com/x", { match: "contains", pattern: "pricing" }),
        rule("https://a.com/pricing"),
      ),
    ).toBe(true);
  });

  it("never overlaps across disjoint devices", () => {
    expect(
      pageRulesOverlap(
        rule("https://a.com/pricing", { devices: ["mobile"] }),
        rule("https://a.com/pricing", { devices: ["desktop", "tablet"] }),
      ),
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("flattens draft errors to step.field keys", () => {
    expect(
      flattenDraftErrors({ basics: { url: "Enter the page URL." }, goal: { conv: "x" } }),
    ).toEqual({
      "basics.url": ["Enter the page URL."],
      "goal.conv": ["x"],
    });
  });

  it("derives initials", () => {
    expect(initialsOf("Dana Whitfield", "d@x.com")).toBe("DW");
    expect(initialsOf("Cher", "c@x.com")).toBe("CH");
    expect(initialsOf(null, "priya@x.com")).toBe("PR");
  });
});
