/**
 * Google Tag Manager, as far as install checking needs it. Pure.
 *
 * GTM injects a Custom HTML tag at runtime, so a fetched page's HTML never contains it. Its
 * *published* container is public, though: `gtm.js?id=GTM-XXXX` holds every live tag as a string.
 * Reading it tells apart the two things a marketer can get wrong: a tag that was saved but never
 * published, and a tag holding another project's id. It says nothing about whether the SDK then
 * ran, which only a real browser can show (`lib/install-verification.ts`).
 *
 * Routely never signs in to GTM and never changes a container.
 */

import { SDK_PROTOCOL_VERSION } from "@routely/sdk/contract";

import { OPTIMIZER_OPT_OUT, antiFlickerScript } from "@/lib/snippet";

/** A container id, as the standard GTM install writes it into the page. */
const CONTAINER_ID = /\bGTM-[A-Z0-9]{4,12}\b/g;
/** Only a page that loads GTM counts: a stray "GTM-" in copy is not an install. */
const LOADS_GTM = /googletagmanager\.com|\/gtm\.js|['"]dataLayer['"]/;
/** The most containers one check will fetch. */
export const MAX_CONTAINERS = 3;

export const GTM_URL = "https://tagmanager.google.com/";
export const GTM_ORIGIN = "https://www.googletagmanager.com";

/** Every GTM container a page's HTML loads, in order of appearance. */
export function findGtmContainers(html: string): string[] {
  if (!LOADS_GTM.test(html)) return [];
  return [...new Set(html.match(CONTAINER_ID) ?? [])].slice(0, MAX_CONTAINERS);
}

/**
 * Where a page's anti-flicker block sits, for a Google Tag Manager install (user decision
 * 2026-11-09: required there, and verified). Tag Manager loads after the page starts to render, so
 * the block only hides the original page if it is pasted straight into `<head>`, above the Tag
 * Manager loader; inside a container it would run too late.
 *
 *  - `missing`: no anti-flicker block (`__routelyReveal`) in the HTML;
 *  - `outside_head`: it comes after `</head>` (or `<body>`);
 *  - `below_gtm`: it comes after the page's Tag Manager loader (`gtm.js`);
 *  - `ok`: in `<head>`, above Tag Manager (or no loader in the HTML to be above).
 */
export type AntiFlickerPlacement = "ok" | "missing" | "outside_head" | "below_gtm";

const ANTI_FLICKER_MARK = "__routelyReveal";
const HEAD_END = /<\/head\s*>|<body[\s>]/i;
const GTM_LOADER = /googletagmanager\.com\/gtm\.js/i;

export function antiFlickerPlacement(html: string): AntiFlickerPlacement {
  const at = html.indexOf(ANTI_FLICKER_MARK);
  if (at < 0) return "missing";
  const headEnd = html.search(HEAD_END);
  if (headEnd >= 0 && at > headEnd) return "outside_head";
  const loader = html.search(GTM_LOADER);
  if (loader >= 0 && at > loader) return "below_gtm";
  return "ok";
}

export function gtmContainerUrl(containerId: string, origin: string = GTM_ORIGIN): string {
  return `${origin}/gtm.js?id=${encodeURIComponent(containerId)}`;
}

/**
 * A site id in a container's source. A container escapes its strings (`\"`, `\x22`, `\u0022`), so
 * this looks for an id right after any spelling of a quote rather than parsing an attribute.
 */
const QUOTED_SITE_ID = /(?:["'=]|\\x2[27]|\\u002[27])(rt_[0-9a-z]{24,48})/gi;

/** Which Routely ids a published container carries, this project's aside. */
export function readContainer(
  js: string,
  publicSiteId: string,
): { hasThisProject: boolean; otherSiteIds: string[]; hasAntiFlicker: boolean } {
  const own = publicSiteId.toLowerCase();
  const ids = new Set([...js.matchAll(QUOTED_SITE_ID)].map((match) => match[1]!.toLowerCase()));
  return {
    hasThisProject: js.toLowerCase().includes(own),
    otherSiteIds: [...ids].filter((id) => id !== own),
    // The block's own global; it has no quotes, so the container keeps it verbatim.
    hasAntiFlicker: js.includes(ANTI_FLICKER_MARK),
  };
}

export interface GtmSnippetOptions {
  sdkUrl: string;
  publicSiteId: string;
}

/**
 * The Custom HTML for a GTM tag.
 *
 * It builds the script element itself, for two reasons. GTM re-creates a pasted `<script src>` and
 * what it keeps of the attributes is its own business, whereas `setAttribute` below is plain DOM.
 * And it can stand down: a page that already has a Routely tag (pasted by hand earlier, or a second
 * GTM tag) gets no second copy. The SDK has its own guard for the case this cannot see.
 *
 * The anti-flicker block comes first in the same script (user request 2026-11-09: one tag, nothing
 * pasted into the site's `<head>`). Inside Tag Manager it starts after the page is visible, so it
 * narrows the flash rather than preventing it; the `<head>` block remains the way to prevent it.
 *
 * Both values are escaped for a JavaScript string inside an inline script.
 */
export function buildGtmSnippet({ sdkUrl, publicSiteId }: GtmSnippetOptions): string {
  const config = gtmConfigUrl(sdkUrl, publicSiteId);
  const prefetch = config
    ? `  try { fetch(${jsString(config)}, { credentials: "omit", mode: "cors" })["catch"](function () {}); } catch (e) {}\n`
    : "";
  return `<!-- Routely tracking script with anti-flicker (Google Tag Manager: Custom HTML) -->
<script ${OPTIMIZER_OPT_OUT}>
${antiFlickerScript()}
(function (d) {
  if (d.querySelector("script[data-site-id]")) return;
${prefetch}  var s = d.createElement("script");
  s.async = true;
  s.src = ${jsString(sdkUrl)};
  s.setAttribute("data-site-id", ${jsString(publicSiteId)});
  (d.head || d.documentElement).appendChild(s);
})(document);
</script>`;
}

/**
 * The configuration request the SDK will make, started by the Tag Manager tag while `sdk.js` is
 * still downloading (2026-11-09: a Split URL visitor waits for both before the redirect). It must be
 * byte-for-byte the SDK's own request — same URL (`configUrl` in the SDK's `config.ts`), same
 * `credentials: "omit"`, `mode: "cors"` — so the browser hands the SDK this response from its HTTP
 * cache (the endpoint is cacheable for its `ttl`) instead of fetching again.
 *
 * The SDK's API is the origin it is served from, as every Routely deployment builds it; an
 * `sdkUrl` that is not a URL gets no prefetch rather than a wrong one.
 */
export function gtmConfigUrl(sdkUrl: string, publicSiteId: string): string | null {
  try {
    const { origin } = new URL(sdkUrl);
    return `${origin}/api/v1/config?siteId=${encodeURIComponent(publicSiteId)}&v=${SDK_PROTOCOL_VERSION}`;
  } catch {
    return null;
  }
}

/** A JavaScript string literal that cannot close the surrounding `<script>`. */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}
