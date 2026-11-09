import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readOptions, siteIdOf } from "../src/index";

const tag = (src: string, dataset: Record<string, string> = {}) =>
  ({ src, dataset }) as unknown as HTMLScriptElement;

describe("the site id on the loading script tag", () => {
  // Baked in at build time; a tag Tag Manager stripped has no `data-api` to override it.
  beforeEach(() => vi.stubGlobal("__ROUTELY_API_BASE__", "https://app.test"));
  afterEach(() => vi.unstubAllGlobals());

  it("reads data-site-id, as the <head> install writes it", () => {
    expect(siteIdOf(tag("https://app.test/sdk/v1/sdk.js", { siteId: "rt_abc" }))).toBe("rt_abc");
  });

  it("reads ?key= from the URL when Google Tag Manager has stripped the attributes", () => {
    expect(siteIdOf(tag("https://app.test/sdk/v1/sdk.js?key=rt_abc"))).toBe("rt_abc");
    expect(readOptions(tag("https://app.test/sdk.js?v=1&key=rt_abc#top"))?.siteId).toBe("rt_abc");
  });

  it("prefers data-site-id when both are there", () => {
    expect(siteIdOf(tag("https://app.test/sdk.js?key=rt_url", { siteId: "rt_attr" }))).toBe(
      "rt_attr",
    );
  });

  it("finds nothing on a tag with neither, so the SDK does nothing", () => {
    expect(readOptions(tag("https://app.test/sdk.js?monkey=rt_abc"))).toBeNull();
    expect(readOptions(tag("https://app.test/sdk.js"))).toBeNull();
    expect(readOptions(null)).toBeNull();
  });
});
