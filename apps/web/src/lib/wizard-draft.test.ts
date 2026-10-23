import { describe, expect, it } from "vitest";

import {
  devicesFromFlags,
  flagsFromDevices,
  resumeStep,
  savedAtPhrase,
  savedLabelFor,
  trackingFromChecks,
  typedInt,
} from "@/lib/wizard-draft";

const now = new Date("2026-10-19T15:00:00Z");

describe("saved labels", () => {
  it("reads today / yesterday / a date, in UTC", () => {
    expect(savedLabelFor(new Date("2026-10-19T01:00:00Z"), now)).toBe("Draft saved");
    expect(savedLabelFor(new Date("2026-10-18T23:59:00Z"), now)).toBe("Draft saved yesterday");
    expect(savedLabelFor(new Date("2026-10-09T14:48:00Z"), now)).toBe("Draft saved Oct 9");
    expect(savedAtPhrase(new Date("2026-10-09T14:48:00Z"), now)).toBe("Oct 9 at 2:48 PM");
    expect(savedAtPhrase(new Date("2026-10-18T16:05:00Z"), now)).toBe("yesterday at 4:05 PM");
  });
});

describe("resumeStep", () => {
  it("reopens where the draft was left, but not past the first step with a problem", () => {
    expect(resumeStep(4, [])).toBe(4);
    expect(resumeStep(5, [{ step: 2, field: "split", message: "" }])).toBe(2);
    expect(resumeStep(0, [])).toBe(1);
    expect(resumeStep(9, [])).toBe(5);
  });
});

describe("devices", () => {
  it("round-trips between the wizard's flags and stored devices", () => {
    const flags = { desktop: true, mobile: false, tablet: true };
    expect(devicesFromFlags("specific", flags)).toEqual(["DESKTOP", "TABLET"]);
    expect(devicesFromFlags("all", flags)).toEqual([]);
    expect(flagsFromDevices(["TABLET", "DESKTOP"])).toEqual({
      targeting: "specific",
      devices: flags,
    });
    // All three is the same as everyone.
    expect(flagsFromDevices(["DESKTOP", "MOBILE", "TABLET"]).targeting).toBe("all");
  });

  it("reads typed percentages", () => {
    expect(typedInt("40")).toBe(40);
    expect(typedInt("")).toBeNull();
    expect(typedInt(undefined)).toBeNull();
  });
});

describe("trackingFromChecks", () => {
  const pages = [
    { id: "page", url: "acme.com/" },
    { id: "goal", url: "https://acme.com/thanks/" },
  ];

  it("maps each page to its check by normalised URL", () => {
    expect(
      trackingFromChecks(pages, [
        { urlKey: "https://acme.com", result: "OK" },
        { urlKey: "https://acme.com/thanks", result: "MISSING" },
      ]),
    ).toEqual({ status: "done", results: { page: "ok", goal: "missing" }, details: {} });
  });

  it("keeps the reason a page is missing", () => {
    expect(
      trackingFromChecks(pages, [
        { urlKey: "https://acme.com", result: "OK" },
        { urlKey: "https://acme.com/thanks", result: "MISSING", detail: "Wrong project." },
      ]),
    ).toEqual({
      status: "done",
      results: { page: "ok", goal: "missing" },
      details: { goal: "Wrong project." },
    });
  });

  it("skips a page with no URL yet instead of failing the whole check", () => {
    const noGoal = [pages[0]!, { id: "goal", url: "" }];
    expect(trackingFromChecks(noGoal, [{ urlKey: "https://acme.com", result: "OK" }])).toEqual({
      status: "done",
      results: { page: "ok" },
      details: {},
    });
  });

  it("is an error when any page couldn't be checked", () => {
    expect(
      trackingFromChecks(pages, [
        { urlKey: "https://acme.com", result: "OK" },
        { urlKey: "https://acme.com/thanks", result: "ERROR" },
      ]),
    ).toEqual({ status: "error" });
    expect(trackingFromChecks(pages, [{ urlKey: "https://acme.com", result: "OK" }])).toEqual({
      status: "error",
    });
  });
});
