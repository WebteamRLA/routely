import { describe, expect, it } from "vitest";

import { CACHE_BUSTER_PARAM, withCacheBuster } from "@/lib/cache-buster";

describe("withCacheBuster", () => {
  it("adds its own parameter and keeps the page's query and fragment", () => {
    expect(withCacheBuster("https://acme.com/pricing?plan=pro#faq", 123)).toBe(
      `https://acme.com/pricing?plan=pro&${CACHE_BUSTER_PARAM}=123#faq`,
    );
    expect(withCacheBuster("https://acme.com/", 5)).toBe(
      `https://acme.com/?${CACHE_BUSTER_PARAM}=5`,
    );
  });

  it("leaves something that isn't a URL alone", () => {
    expect(withCacheBuster("not a url", 1)).toBe("not a url");
  });
});
