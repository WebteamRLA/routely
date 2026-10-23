import { describe, expect, it } from "vitest";

import {
  type LaunchRuleExperiment,
  hasPlaceholderChanges,
  isPlaceholderChange,
  isSetupComplete,
  isValidPageUrl,
  issueLines,
  launchSummary,
  pageKey,
  setupIssues,
  shortUrl,
  targetingSummary,
  withScheme,
} from "@/lib/launch-rules";

const ctx = { domain: "acme.com" };

function split(overrides: Partial<LaunchRuleExperiment> = {}): LaunchRuleExperiment {
  return {
    type: "SPLIT_URL",
    name: "Fall sale landing page",
    controlUrl: "https://acme.com/fall-sale",
    conversionUrl: "https://acme.com/checkout/thank-you",
    controlWeight: 50,
    trafficAllocation: 100,
    targetDevices: [],
    variants: [
      {
        id: "v1",
        name: "Variant A",
        url: "https://acme.com/fall-sale-v2",
        weight: 50,
        changes: null,
      },
    ],
    ...overrides,
  };
}

function ab(overrides: Partial<LaunchRuleExperiment> = {}): LaunchRuleExperiment {
  return {
    type: "AB_TEST",
    name: "Fall homepage hero",
    controlUrl: "https://acme.com/",
    conversionUrl: "https://acme.com/collections/fall-sale",
    controlWeight: 50,
    trafficAllocation: 100,
    targetDevices: [],
    variants: [
      {
        id: "v1",
        name: "Variant A",
        url: null,
        weight: 50,
        changes: { schemaVersion: 1, changes: [{}, {}] },
      },
    ],
    ...overrides,
  };
}

const messages = (exp: LaunchRuleExperiment) => setupIssues(exp, ctx).map((i) => i.message);

describe("setupIssues — Split URL", () => {
  it("passes a complete experiment", () => {
    expect(setupIssues(split(), ctx)).toEqual([]);
    expect(isSetupComplete(split(), ctx)).toBe(true);
  });

  it("uses the design's step 1 messages", () => {
    expect(messages(split({ name: " ", controlUrl: "" }))).toEqual([
      "Give your experiment a name.",
      "Enter the URL of the page you want to test.",
    ]);
    expect(messages(split({ controlUrl: "not a url" }))).toContain(
      "Enter a valid URL, like https://acme.com/fall-sale.",
    );
  });

  it("rejects off-domain URLs as errors (D9), subdomains allowed", () => {
    expect(messages(split({ controlUrl: "https://evil-acme.com/x" }))).toEqual([
      "Use a page on acme.com or one of its subdomains.",
    ]);
    expect(messages(split({ controlUrl: "https://shop.acme.com/x" }))).toEqual([]);
  });

  it("checks each variant's name and URL", () => {
    const variants = [
      { id: "a", name: "", url: "", weight: 34, changes: null },
      { id: "b", name: "B", url: "acme.com/fall-sale", weight: 33, changes: null },
      { id: "c", name: "C", url: "https://acme.com/v3", weight: 33, changes: null },
      { id: "d", name: "D", url: "https://ACME.com/v3/", weight: 0, changes: null },
    ];
    const issues = setupIssues(split({ controlWeight: 0, variants }), ctx);
    expect(issues.filter((i) => i.step === 1).map((i) => [i.field, i.message])).toEqual([
      ["variants.a.name", "Give this variant a name."],
      ["variants.a.url", "Enter the URL visitors in this variant will see."],
      ["variants.b.url", "Use a different URL from the Control page."],
      ["variants.d.url", "Each variant needs its own URL."],
    ]);
  });

  it("explains a split that doesn't add up", () => {
    expect(messages(split({ controlWeight: 40 }))).toEqual([
      "10% of traffic isn’t assigned. Adjust the split so it adds up to 100%.",
    ]);
    expect(messages(split({ controlWeight: 70 }))).toEqual([
      "The split adds up to 120%. Reduce it by 20% so it totals 100%.",
    ]);
    expect(messages(split({ controlWeight: 0 }))).toEqual([
      "Every version needs at least 1% of traffic.",
    ]);
    expect(messages(split({ trafficAllocation: null }))).toEqual([
      "Enter a percentage between 1 and 100.",
    ]);
    expect(messages(split({ trafficAllocation: 101 }))).toEqual([
      "Enter a percentage between 1 and 100.",
    ]);
  });

  it("requires a device when targeting specific devices", () => {
    expect(messages(split({ targeting: "specific", targetDevices: [] }))).toEqual([
      "Choose at least one device type.",
    ]);
    expect(messages(split({ targetDevices: ["MOBILE"] }))).toEqual([]);
  });

  it("keeps the goal off every tested page", () => {
    expect(messages(split({ conversionUrl: "https://acme.com/fall-sale-v2" }))).toEqual([
      "The conversion page must be different from the pages you’re testing.",
    ]);
    expect(messages(split({ conversionUrl: "" }))).toEqual([
      "Enter the page that counts as a conversion.",
    ]);
    expect(messages(split({ conversionUrl: "nope" }))).toEqual([
      "Enter a valid URL, like https://acme.com/checkout/thank-you.",
    ]);
  });
});

describe("setupIssues — A/B test", () => {
  it("passes a complete experiment", () => {
    expect(setupIssues(ab(), ctx)).toEqual([]);
  });

  it("needs a change per variant, counted from the stored envelope or an array", () => {
    const variants = [
      { id: "v1", name: "Variant A", url: null, weight: 22, changes: null },
      { id: "v2", name: "Variant B", url: null, weight: 22, changes: [{}] },
      {
        id: "v3",
        name: "Variant C",
        url: null,
        weight: 22,
        changes: { schemaVersion: 1, changes: [] },
      },
    ];
    expect(messages(ab({ controlWeight: 34, variants }))).toEqual([
      "Make at least one change to Variant A in the visual editor.",
      "Make at least one change to Variant C in the visual editor.",
    ]);
  });

  it("uses the A/B wording", () => {
    expect(messages(ab({ controlUrl: "x" }))).toContain(
      "Enter a valid URL, like https://acme.com/.",
    );
    expect(messages(ab({ controlWeight: 60 }))).toEqual(["The split must add up to 100%."]);
    expect(messages(ab({ conversionUrl: "https://acme.com" }))).toEqual([
      "The goal page must be different from the page you’re testing, or every visitor would count as a conversion.",
    ]);
  });

  it("summarises issues per step", () => {
    expect(
      issueLines(setupIssues(ab({ name: "", controlUrl: "", controlWeight: 1 }), ctx)),
    ).toEqual(["Setup & variants: 2 issues", "Traffic: 1 issue"]);
  });

  it("never launches changes made on the design's sample page", () => {
    const real = {
      id: "c1",
      selector: "#hero > h1:nth-of-type(1)",
      kind: "heading",
      set: { text: "Fall sale" },
    };
    const sampleSelector = { ...real, id: "c2", selector: '[data-routely-preview="h1"]' };
    const sampleImage = {
      ...real,
      id: "c3",
      kind: "image",
      set: { src: "https://example.com/routely-preview/camp" },
    };
    const variant = (changes: unknown) => [
      { id: "v1", name: "Variant A", url: null, weight: 50, changes },
    ];

    expect(messages(ab({ variants: variant({ schemaVersion: 1, changes: [real] }) }))).toEqual([]);
    for (const bad of [sampleSelector, sampleImage]) {
      const issues = setupIssues(
        ab({ variants: variant({ schemaVersion: 1, changes: [real, bad] }) }),
        ctx,
      );
      expect(issues).toEqual([
        {
          step: 1,
          field: "variants.v1.changes",
          message:
            "Variant A has changes made on a sample page, not yours. Remove them in the visual editor and make them on your page.",
        },
      ]);
    }
    // A bare array (the wizard's form) is judged the same way; the mock's element ids are not.
    expect(messages(ab({ variants: variant([sampleSelector]) }))).toHaveLength(1);
    expect(messages(ab({ variants: variant(["h1", "cta"]) }))).toEqual([]);

    expect(isPlaceholderChange(sampleImage)).toBe(true);
    expect(isPlaceholderChange({ ...real, set: { src: "https://cdn.example.net/x.png" } })).toBe(
      true,
    );
    expect(isPlaceholderChange({ ...real, set: { src: "https://shop.example/x.png" } })).toBe(true);
    expect(isPlaceholderChange({ ...real, set: { src: "https://myexample.com/x.png" } })).toBe(
      false,
    );
    expect(isPlaceholderChange(real)).toBe(false);
    expect(hasPlaceholderChanges(null)).toBe(false);
  });
});

describe("URL helpers", () => {
  it("accepts scheme-less URLs and refuses hosts without a TLD", () => {
    expect(isValidPageUrl("acme.com/pricing")).toBe(true);
    expect(isValidPageUrl("http://shop.wp.localhost:4100/x")).toBe(true);
    expect(isValidPageUrl("localhost:3000")).toBe(false);
    expect(isValidPageUrl("javascript:alert(1)")).toBe(false);
    expect(withScheme(" acme.com ")).toBe("https://acme.com");
    expect(pageKey("ACME.com/pricing/")).toBe("https://acme.com/pricing");
    expect(shortUrl("https://www.acme.com/cart/")).toBe("acme.com/cart");
  });
});

describe("summaries", () => {
  it("describes targeting both ways", () => {
    expect(targetingSummary([])).toBe("All visitors");
    expect(targetingSummary(["DESKTOP", "MOBILE", "TABLET"])).toBe("All visitors");
    expect(targetingSummary(["TABLET", "DESKTOP"])).toBe("Desktop and tablet");
    expect(targetingSummary(["MOBILE"])).toBe("Mobile only");
    expect(targetingSummary(["DESKTOP", "MOBILE"], "list")).toBe("Desktop, Mobile only");
  });

  it("builds the launch confirm's facts", () => {
    expect(
      launchSummary(ab({ targetDevices: ["DESKTOP", "TABLET"], trafficAllocation: 50 })),
    ).toEqual({
      page: "acme.com",
      include: 50,
      targeting: "Desktop and tablet",
      goal: "acme.com/collections/fall-sale",
      arms: [
        ["Control", "Original page", "50%"],
        ["Variant A", "2 saved changes", "50%"],
      ],
      changes: "Variant A has 2 saved changes",
    });
    expect(launchSummary(split()).arms).toEqual([
      ["Control", "acme.com/fall-sale", "50%"],
      ["Variant A", "acme.com/fall-sale-v2", "50%"],
    ]);
  });

  it("normalises relative weights to percentages", () => {
    const exp = split({
      controlWeight: 50,
      variants: [
        { id: "a", name: "A", url: "https://acme.com/a", weight: 50, changes: null },
        { id: "b", name: "B", url: "https://acme.com/b", weight: 50, changes: null },
      ],
    });
    expect(launchSummary(exp).arms.map((arm) => arm[2])).toEqual(["33%", "33%", "33%"]);
  });
});
