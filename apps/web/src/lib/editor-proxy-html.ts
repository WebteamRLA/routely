/**
 * Rewrites a customer's page for the visual editor's proxy (`/api/editor/proxy`). Pure.
 *
 * The page is served from Routely's proxy origin instead of its own, so:
 *
 *  - a `<base>` pointing at the real page makes its relative links, styles, scripts and images
 *    load from the customer's site exactly as before;
 *  - the page's own Routely tags (the snippet and the anti-flicker block) are removed and one
 *    snippet is added that talks to this Routely app (`data-api`). In editor mode the snippet does
 *    nothing but the handshake — no hit, no assignment — so editing never records a visit;
 *  - `<meta>` tags that would block that script (a CSP), refuse framing, or navigate the page away
 *    (`refresh`) are dropped. The response's own headers decide framing;
 *  - a small script runs before anything else (`PAGE_SHIM`), so the page's own code survives being
 *    somewhere it was not written for (below).
 */

/**
 * Keeps the customer's own scripts from crashing in the copy, which would leave the editor showing
 * the site's error page instead of the site (seen on blinto.co, a Next.js site, 2026-11-09).
 *
 *  - **History.** A router that resolves URLs against `document.baseURI` asks `replaceState` for a
 *    URL on the customer's origin while the document is on the proxy's, which the browser refuses
 *    with a `SecurityError`; Next.js's router does this on hydration. A refused call is retried
 *    without the URL: the state still changes, the address does not, and the editor blocks
 *    navigation anyway.
 *  - **Storage and cookies.** The sandbox's opaque origin makes `localStorage`, `sessionStorage`
 *    and `document.cookie` throw. Where they throw, the copy gets in-memory stand-ins that last for
 *    the page load. This gives the customer's scripts nothing real: the sandbox stays the boundary.
 *
 * Everything is inside one try, so the shim can never be what breaks a page.
 */
export const PAGE_SHIM =
  "(function(){try{var w=window,d=document,h=w.history;" +
  '["pushState","replaceState"].forEach(function(k){var o=h[k];if(typeof o!=="function")return;' +
  "h[k]=function(s,t,u){try{return o.call(h,s,t,u)}catch(e){return o.call(h,s,t)}}});" +
  "function mem(){var m=Object.create(null);return{getItem:function(k){k=String(k);return k in m?m[k]:null}," +
  "setItem:function(k,v){m[String(k)]=String(v)},removeItem:function(k){delete m[String(k)]}," +
  "clear:function(){m=Object.create(null)},key:function(i){var x=Object.keys(m)[i];return x===undefined?null:x}," +
  "get length(){return Object.keys(m).length}}}" +
  '["localStorage","sessionStorage"].forEach(function(k){try{void w[k].length}catch(e){' +
  "Object.defineProperty(w,k,{value:mem(),configurable:true})}});" +
  'try{void d.cookie}catch(e){Object.defineProperty(d,"cookie",{get:function(){return""},' +
  "set:function(){},configurable:true})}" +
  "}catch(e){}})();";

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ROUTELY_TAG = /data-site-id\s*=\s*["']?rt_/i;
const ROUTELY_INLINE = /__routelyReveal|routelyTimeout/;
const BLOCKING_META =
  /<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|x-frame-options|refresh)\b[^>]*>/gi;
const BASE_TAG = /<base\b[^>]*>/gi;
const HEAD_OPEN = /<head\b[^>]*>/i;
const HTML_OPEN = /<html\b[^>]*>/i;

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function rewriteForEditor(
  html: string,
  options: { baseUrl: string; sdkUrl: string; apiOrigin: string; siteId: string },
): string {
  const stripped = html
    .replace(SCRIPT_BLOCK, (block, attrs: string, body: string) =>
      ROUTELY_TAG.test(attrs) || ROUTELY_INLINE.test(body) ? "" : block,
    )
    .replace(BLOCKING_META, "")
    .replace(BASE_TAG, "");

  const inject =
    `<base href="${escapeAttr(options.baseUrl)}">` +
    `<script>${PAGE_SHIM}</script>` +
    `<script src="${escapeAttr(options.sdkUrl)}" data-site-id="${escapeAttr(options.siteId)}"` +
    ` data-api="${escapeAttr(options.apiOrigin)}"></script>`;

  if (HEAD_OPEN.test(stripped)) return stripped.replace(HEAD_OPEN, (tag) => tag + inject);
  if (HTML_OPEN.test(stripped)) {
    return stripped.replace(HTML_OPEN, (tag) => tag + "<head>" + inject + "</head>");
  }
  return "<head>" + inject + "</head>" + stripped;
}

/**
 * The proxied copy's `Content-Security-Policy`. `sandbox allow-scripts` is the security boundary of
 * the whole proxy: without `allow-same-origin` the copy has an opaque origin, so the customer's
 * scripts get no cookies, no storage and no same-origin access to the dashboard it is served
 * beside. Never add `allow-same-origin`. Forms, popups and top-level navigation stay blocked too;
 * the editor agent blocks clicks and submits anyway, so editing loses nothing.
 */
export function editorProxyCsp(appOrigin: string): string {
  return `sandbox allow-scripts; frame-ancestors ${appOrigin}`;
}
