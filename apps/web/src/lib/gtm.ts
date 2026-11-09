/**
 * Google Tag Manager, as far as install checking needs it. Pure.
 *
 * GTM injects a Custom HTML tag at runtime, so a fetched page's HTML never contains it. Its
 * *published* container is public, though: `gtm.js?id=GTM-XXXX` holds every live tag as a string.
 * Reading it tells apart the two things a marketer can get wrong: a tag that was saved but never
 * published, and a tag holding another project's id. It says nothing about whether the SDK then
 * ran, which only a real browser can show (`lib/install-verification.ts`).
 *
 * Routely never signs in to GTM and never changes a container. Customers paste the ordinary install
 * snippet (`lib/snippet.ts`) into a Custom HTML tag; the separate GTM tag this file used to build
 * was removed on 2026-11-09 (as Mida does: one snippet for `<head>` and GTM).
 */

/** A container id, as the standard GTM install writes it into the page. */
const CONTAINER_ID = /\bGTM-[A-Z0-9]{4,12}\b/g;
/** Only a page that loads GTM counts: a stray "GTM-" in copy is not an install. */
const LOADS_GTM = /googletagmanager\.com|\/gtm\.js|['"]dataLayer['"]/;
/** The most containers one check will fetch. */
export const MAX_CONTAINERS = 3;

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
