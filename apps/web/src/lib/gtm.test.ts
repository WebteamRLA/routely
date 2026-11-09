import { describe, expect, it } from "vitest";

import { antiFlickerPlacement, findGtmContainers, gtmContainerUrl, readContainer } from "@/lib/gtm";
import { buildAntiFlickerSnippet, buildInstallSnippet } from "@/lib/snippet";

const OWN = "rt_0123456789abcdef0123456789abcdef";
const OTHER = "rt_fedcba9876543210fedcba9876543210";

describe("findGtmContainers", () => {
  it("reads the standard GTM install", () => {
    const html = `<script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i;
      })(window,document,'script','dataLayer','GTM-ABC1234');</script>`;
    expect(findGtmContainers(html)).toEqual(["GTM-ABC1234"]);
  });

  it("reads a noscript-only reference, and de-duplicates", () => {
    const html = `<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABC1234"></iframe>
      <script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script>`;
    expect(findGtmContainers(html)).toEqual(["GTM-ABC1234"]);
  });

  it("ignores the words GTM-ABC1234 on a page that does not load GTM", () => {
    expect(findGtmContainers("<p>Our ticket GTM-ABC1234 is closed</p>")).toEqual([]);
  });

  it("caps how many containers one check will fetch", () => {
    const ids = ["GTM-AAAA1", "GTM-BBBB2", "GTM-CCCC3", "GTM-DDDD4"];
    expect(findGtmContainers(`googletagmanager.com ${ids.join(" ")}`)).toHaveLength(3);
  });
});

describe("readContainer", () => {
  it.each([
    ["plain", `"vtp_html":"<script data-site-id=\\"${OWN}\\">"`],
    ["\\x22", `s.setAttribute(\\x22data-site-id\\x22,\\x22${OWN}\\x22)`],
    ["\\u0022", `\\u0022${OWN}\\u0022`],
    ["a ?key= in the script URL", `\\x22https://app.test/sdk.js?key=${OWN}\\x22`],
  ])("finds this project's id quoted as %s", (_label, js) => {
    expect(readContainer(js, OWN)).toEqual({
      hasThisProject: true,
      otherSiteIds: [],
      hasAntiFlicker: false,
    });
  });

  it("names another project's id", () => {
    expect(readContainer(`\\x22${OTHER}\\x22`, OWN)).toEqual({
      hasThisProject: false,
      otherSiteIds: [OTHER],
      hasAntiFlicker: false,
    });
  });

  it("does not mistake a word ending in rt_ for an id", () => {
    expect(readContainer(`var start_abcdefghijklmnopqrstuvwxyz0123 = 1`, OWN).otherSiteIds).toEqual(
      [],
    );
  });

  it("recognises the install snippet pasted into a Custom HTML tag, anti-flicker block included", () => {
    const snippet = buildInstallSnippet({ sdkUrl: "https://app.test/sdk.js", publicSiteId: OWN });
    // GTM stores the tag's HTML as an escaped string.
    const container = `var data={"vtp_html":${JSON.stringify(snippet)}};`;
    expect(readContainer(container, OWN)).toEqual({
      hasThisProject: true,
      otherSiteIds: [],
      hasAntiFlicker: true,
    });
  });
});

describe("gtmContainerUrl", () => {
  it("encodes the id", () => {
    expect(gtmContainerUrl("GTM-ABC")).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-ABC");
  });
});

describe("antiFlickerPlacement", () => {
  const block = buildAntiFlickerSnippet();
  const gtm = `<script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','GTM-ABC1234');</script>`;

  it("is ok in <head> above the Tag Manager loader", () => {
    expect(antiFlickerPlacement(`<html><head>${block}${gtm}</head><body></body></html>`)).toBe(
      "ok",
    );
  });

  it("is ok with no loader in the HTML to be above", () => {
    expect(antiFlickerPlacement(`<head>${block}</head><body></body>`)).toBe("ok");
  });

  it("finds it missing, below Tag Manager, or outside <head>", () => {
    expect(antiFlickerPlacement(`<head>${gtm}</head><body></body>`)).toBe("missing");
    expect(antiFlickerPlacement(`<head>${gtm}${block}</head><body></body>`)).toBe("below_gtm");
    expect(antiFlickerPlacement(`<head>${gtm}</head><body>${block}</body>`)).toBe("outside_head");
    expect(antiFlickerPlacement(`<HEAD>${gtm}</HEAD><BODY class="x">${block}</BODY>`)).toBe(
      "outside_head",
    );
  });
});
