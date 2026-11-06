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

import { OPTIMIZER_OPT_OUT } from "@/lib/snippet";

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
): { hasThisProject: boolean; otherSiteIds: string[] } {
  const own = publicSiteId.toLowerCase();
  const ids = new Set([...js.matchAll(QUOTED_SITE_ID)].map((match) => match[1]!.toLowerCase()));
  return {
    hasThisProject: js.toLowerCase().includes(own),
    otherSiteIds: [...ids].filter((id) => id !== own),
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
 * Both values are escaped for a JavaScript string inside an inline script.
 */
export function buildGtmSnippet({ sdkUrl, publicSiteId }: GtmSnippetOptions): string {
  return `<!-- Routely tracking script (Google Tag Manager: Custom HTML) -->
<script ${OPTIMIZER_OPT_OUT}>
(function (d) {
  if (d.querySelector("script[data-site-id]")) return;
  var s = d.createElement("script");
  s.async = true;
  s.src = ${jsString(sdkUrl)};
  s.setAttribute("data-site-id", ${jsString(publicSiteId)});
  (d.head || d.documentElement).appendChild(s);
})(document);
</script>`;
}

/** A JavaScript string literal that cannot close the surrounding `<script>`. */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}
