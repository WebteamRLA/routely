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
 *    (`refresh`) are dropped. The response's own headers decide framing.
 */

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
