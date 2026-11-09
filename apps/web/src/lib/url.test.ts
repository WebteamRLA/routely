import { describe, expect, it } from "vitest";

import { controlUrlsConflict, isSameSite, isSameUrl, normalizeUrl, urlMatches } from "./url";

/**
 * The SDK carries its own copy of this logic — it cannot import from the app. These cases
 * mirror `packages/sdk/test/url.test.ts` so the two implementations cannot drift apart
 * silently: a change to one that is not mirrored fails here or there.
 */
describe("normalizeUrl", () => {
  it("treats the many spellings of one page as the same page", () => {
    for (const variant of [
      "https://acme.test/pricing",
      "https://acme.test/pricing/",
      "https://ACME.test/pricing",
      "https://acme.test/pricing#plans",
      "https://acme.test/pricing?utm_source=ads",
      "https://acme.test/pricing/?fbclid=1#top",
    ]) {
      expect(normalizeUrl(variant)).toBe("https://acme.test/pricing");
    }
  });

  it("rejects anything that is not an absolute http(s) URL", () => {
    for (const bad of ["/p", "javascript:alert(1)", "data:text/html,x", "", "nope"]) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });

  it("strips the SDK's handoff parameters", () => {
    expect(normalizeUrl("https://acme.test/p?_rt_vid=a&_rt_e=b&_rt_v=VARIANT")).toBe(
      "https://acme.test/p",
    );
  });
});

describe("urlMatches", () => {
  it("PREFIX stops at a path boundary", () => {
    const rule = "https://acme.test/pricing";
    expect(urlMatches("https://acme.test/pricing/plans", rule, "PREFIX")).toBe(true);
    expect(urlMatches("https://acme.test/pricing-old", rule, "PREFIX")).toBe(false);
  });
});

describe("isSameSite", () => {
  it("accepts the host and its subdomains", () => {
    expect(isSameSite("https://acme.test/a", "acme.test")).toBe(true);
    expect(isSameSite("https://shop.acme.test/a", "acme.test")).toBe(true);
    expect(isSameSite("https://acme.test/a", "www.acme.test")).toBe(true);
  });

  it("rejects lookalikes that a naive suffix check would accept", () => {
    expect(isSameSite("https://evil-acme.test/a", "acme.test")).toBe(false);
    expect(isSameSite("https://acme.test.evil.test/a", "acme.test")).toBe(false);
    expect(isSameSite("https://notacme.test/a", "acme.test")).toBe(false);
  });
});

describe("controlUrlsConflict", () => {
  it("catches the same page written differently", () => {
    expect(
      controlUrlsConflict(
        { url: "https://acme.test/p", match: "EXACT" },
        { url: "https://acme.test/p/?utm_source=x", match: "EXACT" },
      ),
    ).toBe(true);
  });

  it("catches a PREFIX rule that would claim the other's page", () => {
    expect(
      controlUrlsConflict(
        { url: "https://acme.test/pricing", match: "PREFIX" },
        { url: "https://acme.test/pricing/plans", match: "EXACT" },
      ),
    ).toBe(true);
  });

  it("leaves genuinely different pages alone", () => {
    expect(
      controlUrlsConflict(
        { url: "https://acme.test/a", match: "EXACT" },
        { url: "https://acme.test/b", match: "EXACT" },
      ),
    ).toBe(false);
  });
});

describe("isSameUrl", () => {
  it("ignores what normalisation removes", () => {
    expect(isSameUrl("https://acme.test/p/", "https://acme.test/p?utm_source=x")).toBe(true);
  });
});

describe("http and https name the same page (2026-11-09)", () => {
  it("matches a control saved with http:// on the https:// site, EXACT and PREFIX", () => {
    expect(urlMatches("https://blinto.co/", "http://blinto.co/", "EXACT")).toBe(true);
    expect(urlMatches("https://blinto.co/?utm_source=x", "http://blinto.co", "EXACT")).toBe(true);
    expect(
      urlMatches("https://shop.test/pricing/annual", "http://shop.test/pricing", "PREFIX"),
    ).toBe(true);
    expect(urlMatches("http://shop.test/pricing", "https://shop.test/pricing", "EXACT")).toBe(true);
  });

  it("still tells different pages apart", () => {
    expect(urlMatches("https://blinto.co/about", "http://blinto.co/", "EXACT")).toBe(false);
    expect(urlMatches("https://shop.test/pricing-old", "http://shop.test/pricing", "PREFIX")).toBe(
      false,
    );
    expect(urlMatches("https://other.test/", "http://blinto.co/", "EXACT")).toBe(false);
  });

  it("isSameUrl agrees", () => {
    expect(isSameUrl("http://blinto.co/a", "https://blinto.co/a/")).toBe(true);
    expect(isSameUrl("http://blinto.co/a", "https://blinto.co/b")).toBe(false);
  });
});
