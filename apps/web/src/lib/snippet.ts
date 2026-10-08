/**
 * Install snippet generation.
 *
 * There is exactly **one snippet per website**, never one per experiment. The snippet carries
 * the website's public site id; which experiments are running on that website is resolved by
 * the SDK at runtime. Creating, activating, pausing or deleting an experiment therefore never
 * requires the customer to touch their site again — which is the whole point of installing a
 * tag rather than editing pages.
 *
 * The snippet contains no secret. The public site id is an identifier that appears in page
 * source by design; it permits appending events to one website and nothing else.
 */

/** Escapes a value for safe interpolation into an HTML attribute in generated markup. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface SnippetOptions {
  sdkUrl: string;
  publicSiteId: string;
}

/** How long the anti-flicker overlay may hide the page, in milliseconds. */
export const DEFAULT_ANTI_FLICKER_MS = 1250;

/** Colour painted over the page while a redirect decision is pending. */
export const DEFAULT_ANTI_FLICKER_BACKGROUND = "#fff";

export interface AntiFlickerOptions {
  timeoutMs?: number;
  background?: string;
}

/**
 * The anti-flickering script.
 *
 * A redirect test races the network. The tracking tag is synchronous, so the SDK runs before
 * the page paints — but the *decision* needs the experiment configuration, and that is an HTTP
 * request. While it is in flight the browser paints the control page, so a visitor bound for
 * the variant sees the wrong page for as long as the request took.
 *
 * This script hides the page until the decision is made. It is deliberately **inline and
 * separate from the bundle**, which buys three things:
 *
 *  1. **It runs earlier than any bundle can.** There is no network request in front of it, so
 *     it takes effect at parse time even if the CDN is slow or the tag is moved lower.
 *  2. **The timings are the customer's.** The duration and the colour are plain values at the
 *     top of the script they paste, so a dark site or a slow host is a one-character edit on
 *     their own page — not a redeploy of ours, and not a value baked into a bundle every other
 *     customer shares.
 *  3. **It still lifts if the SDK never arrives.** The timeout belongs to this script, so a
 *     blocked, failed or missing bundle cannot leave a page hidden. That is the failure this
 *     whole mechanism has to be safe against: a cloak that never lifts is a blank site, which
 *     is far worse than the flicker it replaces.
 *
 * It also starts the `window.routely` queue, with a `track` that queues: a custom event fired by
 * the page or a tag manager before the bundle has loaded — `routely.track("signup")` — is then
 * kept and replayed by the SDK instead of throwing on an undefined function.
 *
 * The SDK reveals the page early by calling `window.__routelyReveal()` as soon as it knows the
 * visitor is staying — so in the common case the overlay lasts only as long as the decision,
 * and the timeout is a backstop rather than the mechanism.
 *
 * Two details that look fussy and are not. Every declaration is `!important`, because the
 * customer's own stylesheets are linked *after* this element in document order and would
 * otherwise win on equal specificity. And the overlay is `position:fixed` rather than styles
 * applied to `body` itself — it then covers the viewport regardless of document height, and
 * the host page's box model never participates, so lifting it cannot reflow the page.
 */
export function buildAntiFlickerSnippet({
  timeoutMs = DEFAULT_ANTI_FLICKER_MS,
  background = DEFAULT_ANTI_FLICKER_BACKGROUND,
}: AntiFlickerOptions = {}): string {
  const css =
    "body::after{content:''!important;position:fixed!important;top:0!important;" +
    "right:0!important;bottom:0!important;left:0!important;" +
    `background:${background}!important;z-index:2147483647!important}`;

  return `<!-- Routely anti-flickering script -->
<script>
var routelyTimeout = ${timeoutMs};
!function(d,w,i,t){try{var r=w.routely=w.routely||[];r.track=r.track||function(k){w.routely.push(["track",k])};var h=d.head||d.getElementsByTagName("head")[0];if(!h||d.getElementById(i))return;var s=d.createElement("style");s.id=i;s.appendChild(d.createTextNode("${css}"));h.appendChild(s);var done=false;w.__routelyReveal=function(){if(done)return;done=true;try{s.parentNode&&s.parentNode.removeChild(s)}catch(e){}};setTimeout(w.__routelyReveal,t)}catch(e){}}(document,window,"routely-cloak",routelyTimeout);
</script>`;
}

/**
 * The tracking tag.
 *
 * Loaded synchronously — no `async`, no `defer` — and placed in `<head>`, so the redirect
 * decision happens before the browser paints the control page. That ordering is the reason
 * the installation instructions insist on `<head>` rather than treating it as a preference.
 */
export function buildSnippet({ sdkUrl, publicSiteId }: SnippetOptions): string {
  return `<!-- Routely tracking script (place in <head>) -->
<script src="${escapeAttribute(sdkUrl)}" data-site-id="${escapeAttribute(publicSiteId)}"></script>`;
}

/**
 * Both blocks, in the order they must appear.
 *
 * The anti-flicker script comes first and is not optional: placed after the tag it would still
 * work, but it would hide a page the browser may already have painted, which is the flash it
 * exists to prevent.
 */
export function buildInstallSnippet(
  options: SnippetOptions & AntiFlickerOptions = {} as SnippetOptions,
): string {
  const { sdkUrl, publicSiteId, ...antiFlicker } = options;
  return `${buildAntiFlickerSnippet(antiFlicker)}

${buildSnippet({ sdkUrl, publicSiteId })}`;
}
