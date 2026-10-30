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
      delayedBy: null,
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
      delayedBy: null,
    });
  });

  it("names what delays the code: LiteSpeed, WP Rocket, consent tools, defer", () => {
    const tag = (attrs: string) => `<script ${attrs} data-site-id="${ID}"></script>`;
    // As LiteSpeed's "Delay JS" rewrote it on niftyit-staging.wp1.sh.
    expect(
      detectSnippet(tag('data-optimized="1" type="litespeed/javascript" data-src="/x.js"'), ID)
        .delayedBy,
    ).toBe("LiteSpeed Cache");
    expect(
      detectSnippet(tag('type="rocketlazyloadscript" data-rocket-src="/s.js"'), ID).delayedBy,
    ).toBe("WP Rocket");
    expect(
      detectSnippet(tag('type="text/plain" data-cookieconsent="marketing"'), ID).delayedBy,
    ).toBe("A cookie-consent tool");
    expect(detectSnippet(tag('src="/sdk.js" defer'), ID).delayedBy).toMatch(/defer/);
    // The anti-flicker block delayed counts too: it can no longer hide the page in time.
    expect(
      detectSnippet(
        `<script type="litespeed/javascript">var routelyTimeout=3000;window.__routelyReveal=1</script>` +
          tag('src="/sdk.js"'),
        ID,
      ).delayedBy,
    ).toBe("LiteSpeed Cache");
  });

  it("does not call the install snippet's own tags delayed", () => {
    const html =
      `<script data-no-optimize="1" data-no-defer="1" data-cfasync="false">var routelyTimeout = 3000;</script>` +
      `<script async src="/sdk.js" data-site-id="${ID}" data-no-optimize="1" data-no-defer="1" data-cfasync="false"></script>`;
    expect(detectSnippet(html, ID).delayedBy).toBeNull();
    expect(
      detectSnippet(`<script type="text/javascript" src="/s.js" data-site-id="${ID}">`, ID)
        .delayedBy,
    ).toBeNull();
  });

  it("never matches an empty id", () => {
    expect(detectSnippet("<html>", "").scriptFound).toBe(false);
  });
});
