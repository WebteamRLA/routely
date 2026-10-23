import type { NextRequest } from "next/server";

import { escapeAttr, rewriteForEditor } from "@/lib/editor-proxy-html";
import { isSameSite } from "@/lib/url";
import { db } from "@/server/db";
import { appOrigin, editorProxyOrigin } from "@/server/editor-proxy";
import { readEditorToken } from "@/server/editor-token";
import { rateLimit } from "@/server/http/rate-limit";
import { safeFetch } from "@/server/http/safe-fetch";
import { allowPrivateFetch, sameSitePolicy } from "@/server/services/pixel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer pages are larger than what the install check reads. */
const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const PROXY_RATE_LIMIT = 120;
const PROXY_RATE_WINDOW_MS = 60_000;

/**
 * The visual editor's page proxy, for sites that forbid being framed (`X-Frame-Options`, CSP
 * `frame-ancestors`): it fetches the experiment's page server-side and serves a copy the editor
 * may frame, with this app's snippet in place of the page's own (`lib/editor-proxy-html.ts`).
 *
 * It is not an open proxy:
 *  - it answers only on the proxy origin (`server/editor-proxy.ts`), never the dashboard's, so the
 *    customer's scripts never run where the dashboard's cookies and pages are;
 *  - it needs a valid editor token (HMAC, ≤ 30 min, minted for an Editor of the experiment), and
 *    fetches only a URL on the token's page origin that is on the project's domain;
 *  - the fetch is `safeFetch`: no private addresses in production, every redirect re-checked
 *    against the project's domain, size and time limits.
 *
 * The page is fetched without the user's cookies, so a page behind a login shows its signed-out
 * version. The copy is never cached.
 */
export async function GET(request: NextRequest) {
  const proxy = editorProxyOrigin();
  if (!proxy || request.headers.get("host") !== new URL(proxy).host) {
    return new Response("Not found", { status: 404 });
  }

  const token = request.nextUrl.searchParams.get("t") ?? "";
  const target = request.nextUrl.searchParams.get("u") ?? "";
  const claims = token ? readEditorToken(token) : null;
  if (!claims) {
    return page(
      403,
      "This editing session has expired. Close the visual editor and open it again.",
    );
  }
  if (!rateLimit(`editor-proxy:${claims.userId}`, PROXY_RATE_LIMIT, PROXY_RATE_WINDOW_MS).allowed) {
    return page(429, "Too many page loads. Wait a minute and try again.");
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return page(400, "That page address isn't valid.");
  }
  const website = await db.website.findUnique({
    where: { id: claims.websiteId },
    select: { domain: true, publicSiteId: true },
  });
  if (
    !website ||
    !/^https?:$/.test(url.protocol) ||
    url.origin !== claims.origin ||
    !isSameSite(url.href, website.domain)
  ) {
    return page(400, "This editing session is for a different page.");
  }

  const fetched = await safeFetch(url.href, {
    allowUrl: sameSitePolicy(website.domain),
    allowPrivate: allowPrivateFetch(),
    maxBytes: MAX_PAGE_BYTES,
    userAgent:
      request.headers.get("user-agent") ??
      "Mozilla/5.0 (compatible; RoutelyEditor/1; +https://routely.app)",
  });
  if (!fetched.ok) return page(502, fetched.message);
  if (fetched.status >= 400)
    return page(502, `${fetched.finalUrl} returned HTTP ${fetched.status}.`);
  if (fetched.contentType && !/html/i.test(fetched.contentType)) {
    return page(502, "That address isn't a web page.");
  }

  const app = appOrigin();
  const html = rewriteForEditor(fetched.body, {
    baseUrl: fetched.finalUrl,
    sdkUrl: `${app}/sdk.js`,
    apiOrigin: app,
    siteId: website.publicSiteId,
  });
  return new Response(html, { status: 200, headers: headers(app) });
}

function headers(app: string): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    // Only the dashboard may frame the copy.
    "Content-Security-Policy": `frame-ancestors ${app}`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

/** A plain message inside the editor's frame. The editor itself times out and offers the popup. */
function page(status: number, message: string): Response {
  const body =
    `<!doctype html><meta charset="utf-8"><title>Routely</title>` +
    `<body style="font:14px system-ui,sans-serif;color:#4B5563;display:grid;place-items:center;min-height:90vh;margin:0">` +
    `<p style="max-width:420px;text-align:center">${escapeAttr(message)}</p></body>`;
  return new Response(body, { status, headers: headers(appOrigin()) });
}
