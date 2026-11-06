import { describe, expect, it } from "vitest";

import { buildGtmSnippet, findGtmContainers, gtmContainerUrl, readContainer } from "@/lib/gtm";

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
  ])("finds this project's id quoted as %s", (_label, js) => {
    expect(readContainer(js, OWN)).toEqual({ hasThisProject: true, otherSiteIds: [] });
  });

  it("names another project's id", () => {
    expect(readContainer(`\\x22${OTHER}\\x22`, OWN)).toEqual({
      hasThisProject: false,
      otherSiteIds: [OTHER],
    });
  });

  it("does not mistake a word ending in rt_ for an id", () => {
    expect(readContainer(`var start_abcdefghijklmnopqrstuvwxyz0123 = 1`, OWN).otherSiteIds).toEqual(
      [],
    );
  });
});

describe("gtmContainerUrl", () => {
  it("encodes the id", () => {
    expect(gtmContainerUrl("GTM-ABC")).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-ABC");
  });
});

describe("buildGtmSnippet", () => {
  const snippet = buildGtmSnippet({ sdkUrl: "https://app.test/sdk.js", publicSiteId: OWN });

  it("carries this project's real id and url", () => {
    expect(snippet).toContain(`"${OWN}"`);
    expect(snippet).toContain(`"https://app.test/sdk.js"`);
  });

  it("stands down when a Routely tag is already on the page", () => {
    expect(snippet).toContain(`if (d.querySelector("script[data-site-id]")) return;`);
  });

  it("cannot be closed early by a value", () => {
    const hostile = buildGtmSnippet({ sdkUrl: "x</script><b>", publicSiteId: OWN });
    expect(hostile).not.toContain("</script><b>");
  });
});
