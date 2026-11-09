import { describe, expect, it, vi } from "vitest";

import { SDK_PROTOCOL_VERSION } from "@routely/sdk/contract";

import {
  GTM_HIDE_MAX_MS,
  antiFlickerPlacement,
  buildGtmSnippet,
  findGtmContainers,
  gtmConfigUrl,
  gtmContainerUrl,
  readContainer,
} from "@/lib/gtm";
import { antiFlickerScript, buildAntiFlickerSnippet } from "@/lib/snippet";

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

  it("is one script: the anti-flicker block first, then the loader", () => {
    expect(snippet.match(/<script\b/g)).toHaveLength(1);
    const cover = snippet.indexOf("__routelyReveal");
    const loader = snippet.indexOf('d.createElement("script")');
    expect(cover).toBeGreaterThan(0);
    expect(loader).toBeGreaterThan(cover);
    expect(snippet).toContain(antiFlickerScript());
  });

  it("is recognised in a published container, anti-flicker block included", () => {
    // GTM stores the tag's HTML as an escaped string.
    const container = `var data={"vtp_html":${JSON.stringify(snippet)}};`;
    expect(readContainer(container, OWN)).toMatchObject({
      hasThisProject: true,
      hasAntiFlicker: true,
    });
  });

  it("cannot be closed early by a value", () => {
    const hostile = buildGtmSnippet({ sdkUrl: "x</script><b>", publicSiteId: OWN });
    expect(hostile).not.toContain("</script><b>");
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

describe("the config prefetch in the Tag Manager tag", () => {
  const snippet = buildGtmSnippet({ sdkUrl: "https://app.test/sdk.js", publicSiteId: OWN });

  it("requests exactly what the SDK will, so the browser can reuse it", () => {
    const url = `https://app.test/api/v1/config?siteId=${OWN}&v=${SDK_PROTOCOL_VERSION}`;
    expect(gtmConfigUrl("https://app.test/sdk.js", OWN)).toBe(url);
    expect(snippet).toContain(`fetch("${url}", { credentials: "omit", mode: "cors" })`);
  });

  it("starts before the SDK is added, and only when no Routely tag is on the page", () => {
    const guard = snippet.indexOf("script[data-site-id]");
    const prefetch = snippet.indexOf("fetch(");
    const sdk = snippet.indexOf('d.createElement("script")');
    expect(guard).toBeLessThan(prefetch);
    expect(prefetch).toBeLessThan(sdk);
  });

  it("is left out for an SDK address that isn't a URL", () => {
    expect(gtmConfigUrl("not a url", OWN)).toBeNull();
    expect(buildGtmSnippet({ sdkUrl: "not a url", publicSiteId: OWN })).not.toContain("fetch(");
  });
});

describe("the Tag Manager tag hides a Split URL control while the decision is made", () => {
  const CONTROL = "https://shop.test/pricing";
  const split = (over: Record<string, unknown> = {}) => ({
    id: "exp_1",
    kind: "split_url",
    devices: [],
    control: { url: CONTROL, match: "EXACT" },
    variants: [
      { id: "v1", url: "https://shop.test/pricing-b", weight: 1 },
      { id: "v2", url: "https://shop.test/pricing-c", weight: 1 },
    ],
    ...over,
  });

  interface Page {
    href?: string;
    config?: unknown;
    cached?: unknown;
    local?: Record<string, string>;
    session?: Record<string, string>;
    fetchFails?: boolean;
    sdkReady?: boolean;
    bodyColor?: string;
  }

  /** Runs the real tag against a stubbed page; returns what it did. */
  async function runTag(page: Page = {}) {
    const href = page.href ?? `${CONTROL}?utm_source=x`;
    const head: { children: { id: string; text: string; src?: string }[] } & Record<
      string,
      unknown
    > = { children: [] };
    head.appendChild = (node: { parentNode?: unknown }) => {
      node.parentNode = head;
      head.children.push(node as never);
    };
    head.removeChild = (node: never) => void head.children.splice(head.children.indexOf(node), 1);
    const document = {
      head,
      documentElement: head,
      body: {},
      querySelector: () => null,
      getElementById: (id: string) => head.children.find((n) => n.id === id) ?? null,
      getElementsByTagName: () => [head],
      createElement: () => {
        const node = { id: "", text: "", async: false, setAttribute() {} } as Record<
          string,
          unknown
        >;
        node.appendChild = (t: { text: string }) => (node.text = String(node.text) + t.text);
        return node;
      },
      createTextNode: (text: string) => ({ text }),
    };
    const store = (data: Record<string, string> = {}) => ({
      getItem: (k: string) => data[k] ?? null,
    });
    const session: Record<string, string> = { ...page.session };
    if (page.cached) {
      session[`routely_cfg_${OWN}`] = JSON.stringify({
        expiresAt: Date.now() + 60_000,
        config: page.cached,
      });
    }
    const window: Record<string, unknown> = {
      localStorage: store(page.local),
      sessionStorage: store(session),
      performance: { getEntriesByName: () => [{}] }, // painted: the snippet's own cover stands down
      ...(page.sdkReady ? { routely: { ready: true } } : {}),
    };
    const timers: number[] = [];
    const fetch = vi.fn(async () => {
      if (page.fetchFails) throw new Error("offline");
      return { ok: page.config !== undefined, json: async () => page.config };
    });
    const tag = buildGtmSnippet({ sdkUrl: "https://app.test/sdk.js", publicSiteId: OWN });
    const inner = tag.replace(/^[\s\S]*?<script[^>]*>/, "").replace(/<\/script>\s*$/, "");
    new Function(
      "document",
      "window",
      "location",
      "fetch",
      "setTimeout",
      "getComputedStyle",
      inner,
    )(
      document,
      window,
      new URL(href),
      fetch,
      (fn: () => void, ms: number) => timers.push(ms),
      () => ({ backgroundColor: page.bodyColor ?? "rgba(0, 0, 0, 0)" }),
    );
    const hiddenAtOnce = !!document.getElementById("routely-cloak");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cover = document.getElementById("routely-cloak") as { text: string } | null;
    return {
      hiddenAtOnce,
      hidden: !!cover,
      css: cover?.text ?? "",
      timers,
      fetch,
      reveal: () => (window.__routelyReveal as () => void)(),
      isHidden: () => !!document.getElementById("routely-cloak"),
      loadsSdk: head.children.some(
        (n) => (n as { src?: string }).src === "https://app.test/sdk.js",
      ),
    };
  }

  const config = (...experiments: unknown[]) => ({ v: 5, siteId: OWN, ttl: 60, experiments });

  it("hides a control page when the config answers, and still loads the SDK", async () => {
    const tag = await runTag({ config: config(split()) });
    expect(tag.hiddenAtOnce).toBe(false);
    expect(tag.hidden).toBe(true);
    expect(tag.loadsSdk).toBe(true);
  });

  it("hides at once from the SDK's cached config, on every page after the first", async () => {
    const tag = await runTag({ cached: config(split()), config: config(split()) });
    expect(tag.hiddenAtOnce).toBe(true);
  });

  it("matches PREFIX controls on a path boundary, ignoring case and a trailing slash", async () => {
    const prefix = split({ control: { url: "https://shop.test/Pricing/", match: "PREFIX" } });
    expect(
      (await runTag({ href: "https://shop.test/pricing/annual", config: config(prefix) })).hidden,
    ).toBe(true);
    expect(
      (await runTag({ href: "https://shop.test/pricing-old", config: config(prefix) })).hidden,
    ).toBe(false);
  });

  it("does not hide where no redirect can follow", async () => {
    const cases: Page[] = [
      { href: "https://shop.test/other", config: config(split()) },
      { config: config(split({ kind: "ab_test" })) },
      { config: config(split({ devices: ["mobile"] })) },
      { config: config(split()), local: { routely_a_exp_1: JSON.stringify({ variantId: null }) } },
      { config: config(split()), local: { routely_i_exp_1: JSON.stringify({ included: false }) } },
      { href: `${CONTROL}?_rt_vid=abc`, config: config(split()) },
      { config: config(split()), session: { routely_r_exp_1: String(Date.now()) } },
      { config: config(split()), sdkReady: true },
      { config: config() },
      { fetchFails: true },
      {},
    ];
    for (const page of cases) expect((await runTag(page)).hidden).toBe(false);
  });

  it("hides a visitor whose stored arm is a variant", async () => {
    const local = { routely_a_exp_1: JSON.stringify({ variantId: "v2" }) };
    expect((await runTag({ config: config(split()), local })).hidden).toBe(true);
  });

  it("can be lifted by the SDK, and lifts itself after the safety timeout", async () => {
    const tag = await runTag({ config: config(split()) });
    expect(tag.timers).toContain(GTM_HIDE_MAX_MS);
    tag.reveal();
    expect(tag.isHidden()).toBe(false);
  });

  it("covers in the page's own background colour, white when it has none", async () => {
    expect((await runTag({ config: config(split()) })).css).toContain("background:#fff");
    expect((await runTag({ config: config(split()), bodyColor: "rgb(17, 24, 39)" })).css).toContain(
      "background:rgb(17, 24, 39)",
    );
  });

  it("makes no request the SDK would not make: one prefetch, the SDK's own", async () => {
    const tag = await runTag({ config: config(split()) });
    expect(tag.fetch).toHaveBeenCalledTimes(1);
    expect(tag.fetch.mock.calls[0]).toEqual([
      gtmConfigUrl("https://app.test/sdk.js", OWN),
      { credentials: "omit", mode: "cors" },
    ]);
  });
});
