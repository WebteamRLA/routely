import { describe, expect, it } from "vitest";

import { detectSnippet } from "./snippet-detect";

const ID = "rt_0123456789abcdef0123456789abcdef";

describe("detectSnippet", () => {
  it("finds this website's tag", () => {
    const html = `<head><script src="https://cdn/sdk.js" data-site-id="${ID}"></script></head>`;
    expect(detectSnippet(html, ID)).toEqual({
      scriptFound: true,
      antiFlickerFound: false,
      wrongSiteId: false,
      otherSiteIds: [],
    });
  });

  it("finds the anti-flicker block", () => {
    const html = `<script>window.__routelyReveal=function(){}</script><script data-site-id='${ID}'></script>`;
    expect(detectSnippet(html, ID).antiFlickerFound).toBe(true);
  });

  it("names a tag for a different website", () => {
    const html = `<script data-site-id="rt_ffffffffffffffffffffffffffffffff"></script>`;
    expect(detectSnippet(html, ID)).toMatchObject({ scriptFound: false, wrongSiteId: true });
    expect(detectSnippet(html, ID).otherSiteIds.length).toBe(1);
  });

  it("counts the page as installed when an old project's tag is left beside this one", () => {
    const html = `<script data-site-id="rt_0000"></script><script data-site-id="${ID}"></script>`;
    expect(detectSnippet(html, ID)).toMatchObject({ scriptFound: true, wrongSiteId: false });
  });

  it("finds the id however it was written (tag manager variable)", () => {
    expect(detectSnippet(`dataLayer.push({routely:"${ID}"})`, ID).scriptFound).toBe(true);
  });

  it("reports nothing for a page without Routely", () => {
    expect(detectSnippet("<html><head></head></html>", ID)).toEqual({
      scriptFound: false,
      antiFlickerFound: false,
      wrongSiteId: false,
      otherSiteIds: [],
    });
  });

  it("never matches an empty id", () => {
    expect(detectSnippet("<html>", "").scriptFound).toBe(false);
  });
});
