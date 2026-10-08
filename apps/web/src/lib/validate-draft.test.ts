import { describe, expect, it } from "vitest";

import type { ExperimentDraft, ExperimentDraftSource } from "./domain";
import {
  addArm,
  draftFromExperiment,
  duplicateDraft,
  errorList,
  firstErrorStep,
  hasErrors,
  leaveBasics,
  newDraft,
  removeArm,
  setDraftType,
  stepIndex,
  validateDraft,
} from "./validate-draft";

const change = { selector: "h1", prop: "text" as const, value: "New", el: "headline" as const };

function validRedirect(): ExperimentDraft {
  const d = newDraft("p1", "redirect");
  return {
    ...d,
    name: "Pricing test",
    url: "https://acme.com/pricing",
    arms: [
      { ...d.arms[0]!, url: "https://acme.com/pricing" },
      { ...d.arms[1]!, url: "https://acme.com/pricing-v2" },
    ],
    targeting: { ...d.targeting, pattern: "https://acme.com/pricing" },
    convUrl: "https://acme.com/thanks",
  };
}

function validAb(): ExperimentDraft {
  const d = newDraft("p1", "ab");
  return {
    ...d,
    name: "Hero copy",
    url: "https://acme.com/",
    arms: [d.arms[0]!, { ...d.arms[1]!, changes: [change] }],
    targeting: { ...d.targeting, pattern: "https://acme.com/" },
    goal: "metric_1",
  };
}

describe("validateDraft", () => {
  it("accepts complete drafts of both types", () => {
    expect(validateDraft(validRedirect())).toEqual({});
    expect(validateDraft(validAb())).toEqual({});
  });

  it("reports a blank draft on every step, with the prototype's messages", () => {
    expect(validateDraft(newDraft("p", "redirect"))).toEqual({
      basics: { name: "Give your experiment a name.", url: "Enter the control URL." },
      variants: { v1: "Enter a URL for Variant A." },
      targeting: { pattern: "Enter a page URL or pattern." },
      goal: { conv: "Enter the conversion URL: the page that counts as a conversion." },
    });
    expect(validateDraft(newDraft("p", "ab"))).toEqual({
      basics: { name: "Give your experiment a name.", url: "Enter the page URL." },
      variants: { v1: "Variant A has no changes yet, so it would be identical to Control." },
      targeting: { pattern: "Enter a page URL or pattern." },
      goal: { goal: "Choose the primary goal this experiment is judged on." },
    });
  });

  it("checks name length and URL shape", () => {
    const d = { ...validRedirect(), name: " ab ", url: "acme.com/pricing" };
    expect(validateDraft(d).basics).toEqual({
      name: "Use at least 3 characters.",
      url: "Use a full URL, e.g. https://example.com/landing-page",
    });
  });

  it("checks variant URLs: shape, same as control, duplicates", () => {
    const d = validRedirect();
    d.arms = [
      d.arms[0]!,
      { ...d.arms[1]!, url: "acme.com/x" },
      { name: "Variant B", url: "https://acme.com/pricing/?utm=1", weight: 0, changes: [] },
      { name: "Variant C", url: "https://acme.com/v", weight: 0, changes: [] },
      { name: "Variant D", url: "https://acme.com/v/", weight: 0, changes: [] },
    ];
    d.arms[0]!.weight = 100;
    expect(validateDraft(d).variants).toEqual({
      v1: "This doesn't look like a full URL (https://…).",
      v2: "Must be different from the control URL.",
      v4: "Same URL as Variant C.",
    });
  });

  it("requires the allocation to total 100", () => {
    const d = validAb();
    d.arms = [
      { ...d.arms[0]!, weight: 60 },
      { ...d.arms[1]!, weight: 30 },
    ];
    expect(validateDraft(d).traffic).toEqual({
      sum: "Allocation adds up to 90%. It must equal 100%.",
    });
  });

  it("checks the conversion URL in url mode", () => {
    const cases: [string, string][] = [
      ["thanks", "Use a full URL, e.g. https://example.com/thank-you"],
      ["https://acme.com/pricing/", "The conversion URL can’t be the same as the entry URL."],
      ["http://acme.com/pricing-v2?x", "The conversion URL can’t be one of the variant URLs."],
    ];
    for (const [convUrl, msg] of cases) {
      expect(validateDraft({ ...validRedirect(), convUrl }).goal).toEqual({ conv: msg });
    }
  });

  it("requires a metric in event mode, for either type", () => {
    expect(validateDraft({ ...validRedirect(), goalMode: "event", goal: "" }).goal).toEqual({
      goal: "Choose the primary goal this experiment is judged on.",
    });
    expect(validateDraft({ ...validRedirect(), goalMode: "event", goal: "m" })).toEqual({});
  });

  it("includes targeting errors", () => {
    const d = validAb();
    d.targeting = { ...d.targeting, match: "regex", pattern: "([" };
    expect(validateDraft(d).targeting).toEqual({ pattern: "Invalid regular expression." });
  });
});

describe("error helpers", () => {
  it("finds, counts and flattens in step order", () => {
    const e = validateDraft(newDraft("p", "ab"));
    expect(hasErrors(e)).toBe(true);
    expect(hasErrors(e, "traffic")).toBe(false);
    expect(firstErrorStep(e)).toBe("basics");
    expect(errorList(e).map((x) => [x.stepLabel, x.key])).toEqual([
      ["Setup", "name"],
      ["Setup", "url"],
      ["Variants", "v1"],
      ["Targeting", "pattern"],
      ["Goals", "goal"],
    ]);
    expect(hasErrors({})).toBe(false);
    expect(firstErrorStep({})).toBeNull();
    expect(stepIndex("review")).toBe(6);
  });
});

describe("draft transitions", () => {
  it("newDraft picks the goal mode by type", () => {
    expect(newDraft("p", "redirect").goalMode).toBe("url");
    expect(newDraft("p", "ab").goalMode).toBe("event");
    expect(newDraft("p", "ab").arms.map((a) => [a.name, a.weight])).toEqual([
      ["Control", 50],
      ["Variant A", 50],
    ]);
  });

  it("setDraftType forces event goals for A/B", () => {
    expect(setDraftType(newDraft("p", "redirect"), "ab").goalMode).toBe("event");
    expect(setDraftType(newDraft("p", "ab"), "redirect").goalMode).toBe("url");
    expect(setDraftType({ ...newDraft("p", "ab"), goal: "m" }, "redirect").goalMode).toBe("event");
  });

  it("adds up to five arms and re-splits", () => {
    let d = newDraft("p", "ab");
    d = addArm(d);
    expect(d.arms.map((a) => [a.name, a.weight])).toEqual([
      ["Control", 34],
      ["Variant A", 33],
      ["Variant B", 33],
    ]);
    d = addArm(addArm(d));
    expect(d.arms).toHaveLength(5);
    expect(addArm(d)).toBe(d);
  });

  it("removes an arm, renames and re-splits; never control or below two", () => {
    let d = addArm(addArm(newDraft("p", "redirect")));
    d.arms[2]!.url = "https://b";
    d.arms[3]!.url = "https://c";
    d = removeArm(d, 2);
    expect(d.arms.map((a) => [a.name, a.url, a.weight])).toEqual([
      ["Control", "", 34],
      ["Variant A", "", 33],
      ["Variant B", "https://c", 33],
    ]);
    expect(removeArm(d, 0)).toBe(d);
    const two = newDraft("p", "ab");
    expect(removeArm(two, 1)).toBe(two);
  });

  it("leaveBasics fills control URL and auto targeting, keeping customised values", () => {
    const d = { ...newDraft("p", "redirect"), url: "https://acme.com/a" };
    const out = leaveBasics(d, null);
    expect(out.arms[0]!.url).toBe("https://acme.com/a");
    expect(out.targeting.pattern).toBe("https://acme.com/a");
    expect(out.targeting.testUrl).toBe("https://acme.com/a");

    const moved = leaveBasics({ ...out, url: "https://acme.com/b" }, "https://acme.com/a");
    expect(moved.targeting.pattern).toBe("https://acme.com/b");

    const custom = {
      ...out,
      url: "https://acme.com/c",
      targeting: { ...out.targeting, pattern: "acme.com/*" },
    };
    expect(leaveBasics(custom, "https://acme.com/a").targeting.pattern).toBe("acme.com/*");

    const wild = {
      ...out,
      url: "https://acme.com/d",
      targeting: { ...out.targeting, pattern: "https://acme.com/a/*" },
    };
    expect(leaveBasics(wild, "https://acme.com/a/").targeting.pattern).toBe("https://acme.com/d");

    const ab = leaveBasics({ ...newDraft("p", "ab"), url: "https://acme.com/" }, null);
    expect(ab.arms[0]!.url).toBe("");
  });

  it("draftFromExperiment maps a stored experiment", () => {
    const src: ExperimentDraftSource = {
      id: "e1",
      projectId: "p1",
      type: "redirect",
      name: "Demo",
      url: "https://acme.com/demo",
      hypothesis: null,
      arms: [
        { id: null, url: null, weight: 50 },
        { id: "v1", url: "https://acme.com/demo-v2", weight: 50, changes: [change] },
      ],
      coverage: 0,
      targeting: null,
      goalMetricId: null,
      conversionUrl: "https://acme.com/thanks",
      conversionMatch: "starts",
      secondaryMetricIds: ["m2"],
      counting: "all",
    };
    const d = draftFromExperiment(src);
    expect(d).toMatchObject({
      id: "e1",
      hypothesis: "",
      coverage: 100,
      goalMode: "url",
      goal: "",
      convUrl: "https://acme.com/thanks",
      convMatch: "starts",
      secondary: ["m2"],
      counting: "all",
    });
    expect(d.arms).toEqual([
      { name: "Control", url: "https://acme.com/demo", weight: 50, changes: [] },
      { id: "v1", name: "Variant A", url: "https://acme.com/demo-v2", weight: 50, changes: [] },
    ]);
    expect(d.targeting.pattern).toBe("https://acme.com/demo");
    expect(validateDraft({ ...d, name: "Demo test" })).toEqual({});

    const ab = draftFromExperiment({ ...src, type: "ab", goalMetricId: "m1", conversionUrl: null });
    expect(ab.goalMode).toBe("event");
    expect(ab.arms[1]!.changes).toEqual([change]);
    expect(ab.arms[1]!.changes[0]).not.toBe(change);
    expect(ab.arms[1]!.url).toBe("");
    expect(draftFromExperiment({ ...src, type: "ab", conversionUrl: null }).goalMode).toBe("event");
  });

  it("duplicateDraft drops ids", () => {
    const d = duplicateDraft({
      ...validAb(),
      id: "e1",
      arms: validAb().arms.map((a, i) => (i ? { ...a, id: "v" } : a)),
    });
    expect(d.id).toBeNull();
    expect(d.name).toBe("Copy of Hero copy");
    expect(d.arms.every((a) => !("id" in a))).toBe(true);
  });
});
