import { describe, expect, it } from "vitest";

import { defaultTargeting, type Targeting } from "./domain";
import { matches, normalizeTargeting, targetSummary, targetingErrors } from "./targeting";

describe("matches", () => {
  it("returns null when there is nothing to test", () => {
    expect(matches("exact", "", "https://a.com")).toBeNull();
    expect(matches("exact", "a.com", "")).toBeNull();
  });

  it("exact ignores protocol, query and trailing slash", () => {
    expect(matches("exact", "https://a.com/x", "http://a.com/x/?utm=1")).toBe(true);
    expect(matches("exact", "https://a.com/x", "https://a.com/xy")).toBe(false);
  });

  it("contains and starts", () => {
    expect(matches("contains", "pricing", "https://a.com/en/pricing")).toBe(true);
    expect(matches("starts", "a.com/blog", "https://a.com/blog/post")).toBe(true);
    expect(matches("starts", "a.com/blog", "https://b.com/a.com/blog")).toBe(false);
  });

  it("wildcard matches any run and tolerates a missing trailing segment", () => {
    expect(matches("wildcard", "https://a.com/blog/*", "https://a.com/blog/how-to")).toBe(true);
    expect(matches("wildcard", "https://a.com/blog/*", "https://a.com/blog")).toBe(true);
    expect(matches("wildcard", "https://a.com/blog/*", "https://a.com/news/x")).toBe(false);
    expect(matches("wildcard", "*.a.com/x", "https://shop.a.com/x")).toBe(true);
    // Dots are literal, not regex wildcards.
    expect(matches("wildcard", "a.com/x", "https://aXcom/x")).toBe(false);
  });

  it("regex tests the raw URL and reports invalid patterns", () => {
    expect(matches("regex", "^https://a\\.com/(x|y)$", "https://a.com/y")).toBe(true);
    expect(matches("regex", "^https://a\\.com/(x|y)$", "https://a.com/z")).toBe(false);
    expect(matches("regex", "([", "https://a.com")).toBe("invalid");
  });
});

describe("targetSummary", () => {
  it("describes the defaults", () => {
    expect(targetSummary(defaultTargeting("https://a.com/pricing/"))).toBe(
      "Runs for all visitors on any device in all locations, on pages that exactly match a.com/pricing.",
    );
  });

  it("names countries, devices and conditions", () => {
    const t: Targeting = {
      ...defaultTargeting("https://a.com/blog/*"),
      match: "wildcard",
      audience: "new",
      devices: ["desktop", "mobile"],
      geo: "some",
      geoMode: "exclude",
      countries: ["US", "GB", "ZZ"],
      logic: "any",
      conditions: [
        { field: "query", key: "ref", op: "equals", value: "ads" },
        { field: "utm_source", key: "", op: "exists", value: "" },
        { field: "query", key: "", op: "not", value: "" },
      ],
    };
    expect(targetSummary(t)).toBe(
      "Runs for new visitors on desktop and mobile outside United States, United Kingdom, ZZ, on pages that match a.com/blog/*, when ref is “ads” or utm_source exists or param is not “…”.",
    );
  });

  it("covers the empty cases", () => {
    const t = { ...defaultTargeting(""), devices: [], geo: "some" as const };
    expect(targetSummary(t)).toBe(
      "Runs for all visitors on no devices in no locations yet, on pages that exactly match ….",
    );
  });
});

describe("normalizeTargeting", () => {
  it("defaults null and junk to the fallback pattern", () => {
    expect(normalizeTargeting(null, "https://a.com/x")).toEqual(
      defaultTargeting("https://a.com/x"),
    );
    expect(normalizeTargeting("nope", "u")).toEqual(defaultTargeting("u"));
    expect(normalizeTargeting([], "u")).toEqual(defaultTargeting("u"));
  });

  it("keeps valid fields and drops invalid ones", () => {
    const t = normalizeTargeting(
      {
        match: "wildcard",
        pattern: "https://a.com/*",
        audience: "returning",
        devices: ["mobile", "toaster", "desktop"],
        geo: "some",
        geoMode: "exclude",
        countries: ["us", "US", "Germany", 4, "gb"],
        logic: "any",
        conditions: [
          { field: "utm_medium", op: "contains", value: 5 },
          "junk",
          { field: "x", op: "y" },
        ],
      },
      "fallback",
    );
    expect(t).toEqual({
      match: "wildcard",
      pattern: "https://a.com/*",
      testUrl: "https://a.com/*",
      audience: "returning",
      devices: ["desktop", "mobile"],
      geo: "some",
      geoMode: "exclude",
      countries: ["US", "GB"],
      logic: "any",
      conditions: [
        { field: "utm_medium", key: "", op: "contains", value: "5" },
        { field: "query", key: "", op: "equals", value: "" },
      ],
    });
  });

  it("falls back on unknown enum values and a blank pattern", () => {
    const t = normalizeTargeting({ match: "fuzzy", pattern: "  ", audience: "bots", geo: 1 }, "p");
    expect(t).toMatchObject({ match: "exact", pattern: "p", audience: "all", geo: "all" });
  });
});

describe("targetingErrors", () => {
  it("passes the defaults with a pattern", () => {
    expect(targetingErrors(defaultTargeting("https://a.com"))).toEqual({});
  });

  it("reports each rule with the prototype's keys", () => {
    const t: Targeting = {
      ...defaultTargeting(""),
      devices: [],
      geo: "some",
      conditions: [
        { field: "query", key: " ", op: "equals", value: "" },
        { field: "referrer", key: "", op: "exists", value: "" },
        { field: "utm_source", key: "", op: "contains", value: " " },
      ],
    };
    expect(targetingErrors(t)).toEqual({
      pattern: "Enter a page URL or pattern.",
      devices: "Select at least one device type.",
      geo: "Add at least one country, or target all locations.",
      k0: "Enter the parameter name.",
      c0: "Enter a value.",
      c2: "Enter a value.",
    });
  });

  it("rejects an invalid regex only in regex mode", () => {
    expect(targetingErrors({ ...defaultTargeting("(["), match: "regex" }).pattern).toBe(
      "Invalid regular expression.",
    );
    expect(targetingErrors({ ...defaultTargeting("(["), match: "contains" })).toEqual({});
  });
});
