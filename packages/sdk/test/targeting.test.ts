import { describe, expect, it } from "vitest";

import type { TargetingConfig } from "../src/contract";
import {
  type VisitContext,
  conditionHolds,
  detectDevice,
  isBotAgent,
  isTargeted,
  matches,
  pageMatches,
  stripU,
} from "../src/targeting";

/**
 * Mirrors `apps/web/src/lib/targeting.test.ts` / the prototype's `matches()`: the URL the
 * wizard's "Test a URL" accepts must be a URL the SDK runs on. `apps/web/src/lib/
 * targeting-mirror.test.ts` runs both implementations over one case table.
 */
describe("matches (mirror of the app's page rule)", () => {
  it("strips protocol, query and trailing slash before comparing", () => {
    expect(stripU(" https://acme.com/pricing/?a=1 ")).toBe("acme.com/pricing");
    expect(matches("exact", "https://acme.com/pricing", "http://acme.com/pricing/?x=1")).toBe(true);
    expect(matches("exact", "acme.com/pricing", "https://acme.com/pricing/plans")).toBe(false);
  });

  it("supports contains and starts", () => {
    expect(matches("contains", "/blog/", "https://acme.com/en/blog/post")).toBe(true);
    expect(matches("contains", "/shop", "https://acme.com/blog")).toBe(false);
    expect(matches("starts", "acme.com/blog", "https://acme.com/blog/post")).toBe(true);
    expect(matches("starts", "acme.com/blog", "https://www.acme.com/blog")).toBe(false);
  });

  it("supports wildcards, including the bare parent", () => {
    expect(matches("wildcard", "acme.com/blog/*", "https://acme.com/blog/a/b")).toBe(true);
    expect(matches("wildcard", "acme.com/blog/*", "https://acme.com/blog")).toBe(true);
    expect(matches("wildcard", "acme.com/*/pricing", "https://acme.com/en/pricing")).toBe(true);
    expect(matches("wildcard", "acme.com/blog/*", "https://acme.com/shop")).toBe(false);
    expect(matches("wildcard", "acme.com/a.b", "https://acme.com/aXb")).toBe(false);
  });

  it("tests a regex against the raw URL and reports an invalid one", () => {
    expect(matches("regex", "utm_source=ads", "https://acme.com/?utm_source=ads")).toBe(true);
    expect(matches("regex", "^https://acme\\.com/p$", "https://acme.com/q")).toBe(false);
    expect(matches("regex", "([", "https://acme.com/")).toBe("invalid");
  });

  it("returns null when there is nothing to test", () => {
    expect(matches("exact", "", "https://acme.com")).toBeNull();
    expect(matches("exact", "acme.com", "")).toBeNull();
    expect(matches("nonsense", "acme.com", "https://acme.com")).toBeNull();
  });
});

describe("pageMatches", () => {
  it("ignores the fragment", () => {
    expect(pageMatches({ match: "exact", pattern: "acme.com/p" }, "https://acme.com/p#top")).toBe(
      true,
    );
  });

  it("keeps the legacy EXACT/PREFIX semantics for experiments without targeting", () => {
    const prefix = { match: "PREFIX" as const, pattern: "https://acme.com/pricing" };
    expect(pageMatches(prefix, "https://acme.com/pricing/plans")).toBe(true);
    expect(pageMatches(prefix, "https://acme.com/pricing-old")).toBe(false);
    // Legacy EXACT compares meaningful query parameters; the targeting step's `exact` does not.
    const exact = { match: "EXACT" as const, pattern: "https://acme.com/l?ref=a" };
    expect(pageMatches(exact, "https://acme.com/l?ref=b")).toBe(false);
    expect(
      pageMatches({ match: "exact", pattern: exact.pattern }, "https://acme.com/l?ref=b"),
    ).toBe(true);
  });

  it("never matches an invalid regex", () => {
    expect(pageMatches({ match: "regex", pattern: "([" }, "https://acme.com/")).toBe(false);
  });
});

describe("detectDevice", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36";
  const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/120 Safari/537.36";
  const IPAD_OS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari";
  const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36";

  it("classifies by user agent", () => {
    expect(detectDevice(IPHONE, 390, 5)).toBe("mobile");
    expect(detectDevice(ANDROID_PHONE, 412, 5)).toBe("mobile");
    expect(detectDevice(ANDROID_TABLET, 1280, 5)).toBe("tablet");
    expect(detectDevice(DESKTOP, 1920, 0)).toBe("desktop");
  });

  it("recognises iPadOS, which reports a desktop user agent", () => {
    expect(detectDevice(IPAD_OS, 1024, 5)).toBe("tablet");
    expect(detectDevice(IPAD_OS, 1440, 0)).toBe("desktop");
  });

  it("uses the viewport only on touch screens — a narrow desktop window is still a desktop", () => {
    expect(detectDevice("Unknown", 500, 0)).toBe("desktop");
    expect(detectDevice("Unknown", 500, 2)).toBe("mobile");
    expect(detectDevice("Unknown", 900, 2)).toBe("tablet");
  });
});

const ctx = (over: Partial<VisitContext> = {}): VisitContext => ({
  href: "https://acme.com/p?utm_source=Google&ref=x",
  referrer: "https://news.example/item",
  device: "desktop",
  isNewVisitor: true,
  ...over,
});

describe("conditions", () => {
  it("reads utm parameters from the raw URL, case-insensitively", () => {
    expect(
      conditionHolds({ field: "utm_source", key: "", op: "equals", value: "google" }, ctx()),
    ).toBe(true);
    expect(conditionHolds({ field: "utm_medium", key: "", op: "exists", value: "" }, ctx())).toBe(
      false,
    );
  });

  it("reads a named query parameter", () => {
    expect(conditionHolds({ field: "query", key: "ref", op: "equals", value: "x" }, ctx())).toBe(
      true,
    );
    expect(conditionHolds({ field: "query", key: "ref", op: "not", value: "y" }, ctx())).toBe(true);
    expect(conditionHolds({ field: "query", key: "nope", op: "not", value: "y" }, ctx())).toBe(
      true,
    );
    expect(conditionHolds({ field: "query", key: "nope", op: "contains", value: "" }, ctx())).toBe(
      false,
    );
  });

  it("reads the referrer", () => {
    expect(
      conditionHolds({ field: "referrer", key: "", op: "contains", value: "news.example" }, ctx()),
    ).toBe(true);
    expect(
      conditionHolds(
        { field: "referrer", key: "", op: "exists", value: "" },
        ctx({ referrer: "" }),
      ),
    ).toBe(false);
  });
});

describe("isTargeted", () => {
  const base: TargetingConfig = {
    match: "exact",
    pattern: "acme.com/p",
    audience: "all",
    devices: ["desktop", "tablet", "mobile"],
    logic: "all",
    conditions: [],
  };

  it("lets everyone in by default", () => {
    expect(isTargeted(base, ctx())).toBe(true);
  });

  it("applies the audience", () => {
    expect(isTargeted({ ...base, audience: "new" }, ctx({ isNewVisitor: false }))).toBe(false);
    expect(isTargeted({ ...base, audience: "returning" }, ctx({ isNewVisitor: true }))).toBe(false);
    expect(isTargeted({ ...base, audience: "returning" }, ctx({ isNewVisitor: false }))).toBe(true);
  });

  it("applies devices", () => {
    expect(isTargeted({ ...base, devices: ["mobile"] }, ctx())).toBe(false);
    expect(isTargeted({ ...base, devices: ["mobile"] }, ctx({ device: "mobile" }))).toBe(true);
  });

  it("combines conditions with ALL or ANY", () => {
    const conditions = [
      { field: "utm_source" as const, key: "", op: "equals" as const, value: "google" },
      { field: "utm_campaign" as const, key: "", op: "exists" as const, value: "" },
    ];
    expect(isTargeted({ ...base, conditions, logic: "all" }, ctx())).toBe(false);
    expect(isTargeted({ ...base, conditions, logic: "any" }, ctx())).toBe(true);
  });
});

describe("isBotAgent", () => {
  it("recognises crawlers and headless automation", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36",
      "Mozilla/5.0 Chrome-Lighthouse",
    ]) {
      expect(isBotAgent(ua)).toBe(true);
    }
  });

  it("lets real browsers through", () => {
    expect(isBotAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36")).toBe(
      false,
    );
  });
});
