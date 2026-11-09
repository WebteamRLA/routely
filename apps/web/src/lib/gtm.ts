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
  return `<!-- Routely tracking script with anti-flicker (Google Tag Manager: Custom HTML) -->
<script ${OPTIMIZER_OPT_OUT}>
${antiFlickerScript()}
(function (d, w) {
  if (d.querySelector("script[data-site-id]")) return;
${config ? controlHideScript(publicSiteId, config) : ""}  var s = d.createElement("script");
  s.async = true;
  s.src = ${jsString(sdkUrl)};
  s.setAttribute("data-site-id", ${jsString(publicSiteId)});
  (d.head || d.documentElement).appendChild(s);
})(document, window);
</script>`;
}

/**
 * How long the tag trusts its remembered list of Split URL control pages (`routely_ctl_<site>`,
 * user choice 2026-11-09). Rewritten from every fresh config, so it is only ever as old as the
 * visitor's last visit; past this it is ignored.
 */
export const GTM_MEMORY_MS = 7 * 24 * 60 * 60 * 1000;

/** How long the tag's own cover may stay up if nothing lifts it: a page must never stay hidden. */
export const GTM_HIDE_MAX_MS = 2500;

/**
 * Hides a Split URL **control** page from the moment the tag can tell it is one, so a visitor who is
 * then sent to a variant never watches the control during the decision (user request 2026-11-09).
 *
 * Tag Manager runs after the page has started to paint, so the first frames are always visible;
 * what this removes is the rest of the wait (`sdk.js`, the config and, for a new visitor,
 * `/api/v1/assign`). The tag only decides **whether to hide**. Where the visitor goes is still the
 * SDK's decision, with the server's arm, so balancing, traffic allocation, loop guards and
 * `keepParams` are untouched, and the SDK reveals or redirects exactly as before: `revealPage` lifts
 * this cover for a visitor who stays, and `coverPage` keeps it through a redirect.
 *
 * It hides only when this page is the control of an active Split URL test (host and path, either
 * scheme like the SDK's `urlMatches`,
 * `EXACT`/`PREFIX`) **and** the visitor may be redirected: no stored control arm (`routely_a_`), not
 * stored as excluded (`routely_i_`), not arriving by a Routely redirect (`_rt_` parameters), and no
 * redirect already pending (`routely_r_`, 30 s). A device-targeted test is left to the SDK. These
 * are the SDK's own storage keys (`assignment.ts`, `inclusion.ts`, `redirect.ts`).
 *
 * When it can tell: at once, from the SDK's per-tab config cache (`routely_cfg_`, every page after
 * the first) or from the tag's own memory of control pages (`routely_ctl_<site>`, written from every
 * config it receives, trusted for `GTM_MEMORY_MS`: a returning visitor is covered the instant Tag
 * Manager runs); otherwise when the prefetched config answers, which is the SDK's own request so
 * the SDK still gets it from the HTTP cache. A cover put up from memory is lifted as soon as the
 * fresh config shows the page is no longer a control (a test ended since the last visit). Never after the SDK has finished (`routely.ready`), so it
 * can't hide a page the SDK already revealed. The cover takes the page's background colour and lifts
 * itself after ${"`GTM_HIDE_MAX_MS`"}.
 */
function controlHideScript(publicSiteId: string, configUrl: string): string {
  return `  var site = ${jsString(publicSiteId)}, memKey = "routely_ctl_" + site, cover = null;
  var read = function (store, key) { try { return JSON.parse(w[store].getItem(key)); } catch (e) { return null; } };
  var norm = function (u) {
    try { var x = new URL(u, location.href); return ("//" + x.host + x.pathname).toLowerCase().replace(/\\/+$/, ""); } catch (e) { return ""; }
  };
  var sdkDone = function () { return !!(w.routely && w.routely.ready); };
  var isControl = function (cfg) {
    try {
      if (!cfg || !cfg.experiments || /[?&]_rt_/.test(location.search)) return false;
      var here = norm(location.href), now = new Date().getTime();
      for (var n = 0; n < cfg.experiments.length; n++) {
        var e = cfg.experiments[n], c = e.control || {}, ctl = norm(c.url || "");
        if ((e.kind || "split_url") !== "split_url" || (e.devices && e.devices.length) || !ctl) continue;
        if (!(here === ctl || (c.match === "PREFIX" && here.indexOf(ctl + "/") === 0))) continue;
        var a = read("localStorage", "routely_a_" + e.id), i = read("localStorage", "routely_i_" + e.id), r = read("sessionStorage", "routely_r_" + e.id);
        if ((a && a.variantId === null) || (i && i.included === false) || (r > 0 && now - r < 30000)) continue;
        return true;
      }
    } catch (x) {}
    return false;
  };
  var hide = function (cfg) {
    try {
      if (!isControl(cfg) || d.getElementById("routely-cloak") || sdkDone()) return;
      var bg = "#fff";
      try { var b = getComputedStyle(d.body).backgroundColor; if (b && b !== "transparent" && !/^rgba\\(.*,\\s*0\\)$/.test(b)) bg = b; } catch (x) {}
      var st = d.createElement("style");
      st.id = "routely-cloak";
      st.appendChild(d.createTextNode("body::after{content:''!important;position:fixed!important;inset:0!important;background:" + bg + "!important;z-index:2147483647!important}"));
      (d.head || d.documentElement).appendChild(st);
      cover = st;
      var done = false;
      w.__routelyReveal = function () { if (done) return; done = true; try { st.parentNode && st.parentNode.removeChild(st); } catch (x) {} };
      setTimeout(w.__routelyReveal, ${GTM_HIDE_MAX_MS});
    } catch (x) {}
  };
  var now0 = new Date().getTime(), cached = read("sessionStorage", "routely_cfg_" + site), mem = read("localStorage", memKey);
  if (cached && cached.expiresAt > now0) hide(cached.config);
  else if (mem && mem.t > now0 - ${GTM_MEMORY_MS}) hide(mem);
  try {
    fetch(${jsString(configUrl)}, { credentials: "omit", mode: "cors" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) {
        if (!cfg || !cfg.experiments) return;
        try {
          var keep = [];
          for (var n = 0; n < cfg.experiments.length; n++) {
            var e = cfg.experiments[n];
            if ((e.kind || "split_url") === "split_url") keep.push({ id: e.id, devices: e.devices, control: e.control });
          }
          w.localStorage.setItem(memKey, JSON.stringify({ t: new Date().getTime(), experiments: keep }));
        } catch (x) {}
        if (isControl(cfg)) hide(cfg);
        else if (cover && cover.parentNode && !sdkDone() && w.__routelyReveal) w.__routelyReveal();
      })["catch"](function () {});
  } catch (x) {}
`;
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
