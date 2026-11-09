import { describe, expect, it } from "vitest";

import { isSameUrl, normalizeUrl, stripHandoff, urlMatches, withHandoff } from "../src/url";

describe("normalizeUrl", () => {
  it("treats the many spellings of one page as the same page", () => {
    const canonical = "https://acme.test/pricing";
    for (const variant of [
      "https://acme.test/pricing",
      "https://acme.test/pricing/",
      "https://ACME.test/pricing",
      "https://acme.test/pricing#plans",
      "https://acme.test/pricing?utm_source=ads&utm_campaign=x",
      "https://acme.test/pricing/?fbclid=123#top",
      "  https://acme.test/pricing  ",
    ]) {
      expect(normalizeUrl(variant)).toBe(canonical);
    }
  });

  it("keeps meaningful query parameters, sorted", () => {
    expect(normalizeUrl("https://acme.test/s?b=2&a=1")).toBe("https://acme.test/s?a=1&b=2");
    expect(normalizeUrl("https://acme.test/s?a=1")).not.toBe(normalizeUrl("https://acme.test/s"));
  });

  it("distinguishes different hosts, paths and schemes", () => {
    expect(normalizeUrl("https://acme.test/a")).not.toBe(normalizeUrl("https://acme.test/b"));
    expect(normalizeUrl("https://acme.test/a")).not.toBe(normalizeUrl("https://other.test/a"));
    expect(normalizeUrl("https://acme.test/a")).not.toBe(normalizeUrl("http://acme.test/a"));
  });

  it("rejects anything that is not an absolute http(s) URL", () => {
    for (const bad of ["/pricing", "javascript:alert(1)", "data:text/html,x", "", "not a url"]) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });

  it("removes the handoff parameters, so a redirected URL still matches", () => {
    expect(normalizeUrl("https://acme.test/p?_rt_vid=abc&_rt_e=exp_1&_rt_v=VARIANT")).toBe(
      "https://acme.test/p",
    );
  });
});

describe("urlMatches", () => {
  it("EXACT matches only that page", () => {
    expect(urlMatches("https://acme.test/p", "https://acme.test/p", "EXACT")).toBe(true);
    expect(urlMatches("https://acme.test/p/sub", "https://acme.test/p", "EXACT")).toBe(false);
  });

  it("PREFIX matches beneath the path but not across a name boundary", () => {
    const rule = "https://acme.test/pricing";
    expect(urlMatches("https://acme.test/pricing", rule, "PREFIX")).toBe(true);
    expect(urlMatches("https://acme.test/pricing/plans", rule, "PREFIX")).toBe(true);
    expect(urlMatches("https://acme.test/pricing?a=1", rule, "PREFIX")).toBe(true);
    expect(urlMatches("https://acme.test/pricing-old", rule, "PREFIX")).toBe(false);
    expect(urlMatches("https://acme.test/pricingx", rule, "PREFIX")).toBe(false);
  });

  it("never matches an unparseable URL", () => {
    expect(urlMatches("not a url", "https://acme.test/p", "EXACT")).toBe(false);
    expect(urlMatches("https://acme.test/p", "not a url", "PREFIX")).toBe(false);
  });
});

describe("handoff", () => {
  it("round-trips and can be stripped back to the original", () => {
    const original = "https://shop.acme.test/v2?keep=1";
    const carried = withHandoff(original, {
      visitorId: "v-1",
      experimentId: "e-1",
      variant: "VARIANT",
    });

    expect(carried).toContain("_rt_vid=v-1");
    expect(stripHandoff(carried)).toBe(original);
  });

  it("leaves an unparseable target alone rather than throwing", () => {
    expect(
      withHandoff("not a url", { visitorId: "v", experimentId: "e", variant: "VARIANT" }),
    ).toBe("not a url");
  });
});

describe("isSameUrl", () => {
  it("ignores the differences normalisation removes", () => {
    expect(isSameUrl("https://acme.test/p/", "https://acme.test/p?utm_source=x")).toBe(true);
    expect(isSameUrl("https://acme.test/p", "https://acme.test/q")).toBe(false);
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
