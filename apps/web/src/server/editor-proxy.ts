import "server-only";

import type { NextRequest } from "next/server";

import { env } from "@/env";

/**
 * Where the visual editor's page proxy (`/api/editor/proxy`) is served, and which dashboard origin a
 * proxied copy belongs to.
 *
 * A proxied page runs the customer's scripts, which must never act with the dashboard's origin —
 * on it they could read the dashboard's pages with the signed-in user's cookies. What prevents that
 * is not the origin the copy is served from but the `sandbox` directive in its
 * `Content-Security-Policy` (`lib/editor-proxy-html.ts`): without `allow-same-origin` the browser
 * gives the document a unique opaque origin, so it has no cookies, no storage and no same-origin
 * access to anything, wherever it was loaded from. That is what lets the proxy run beside the
 * dashboard with no second domain to configure.
 *
 * By default the proxy URL is **relative**, so the copy is served from whichever origin the
 * dashboard was opened on — `localhost`, a tunnel, the production domain — and the copy's snippet
 * and `frame-ancestors` name that same origin, read back from the proxy request. Building it from
 * `NEXT_PUBLIC_APP_URL` instead broke the editor whenever the two differed (a local server opened
 * on `localhost` while that variable named an expired tunnel).
 *
 * `EDITOR_PROXY_ORIGIN` remains as optional extra isolation — another host pointing at this same
 * deployment. The proxy then answers only there, and the dashboard is `NEXT_PUBLIC_APP_URL`.
 */

/** The separate host the proxy is served from, or null when it is served beside the dashboard. */
export function separateProxyOrigin(): string | null {
  return env.EDITOR_PROXY_ORIGIN ? new URL(env.EDITOR_PROXY_ORIGIN).origin : null;
}

/** The dashboard's configured origin. */
export function appOrigin(): string {
  return new URL(env.NEXT_PUBLIC_APP_URL).origin;
}

const HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

/** The first value of a possibly comma-separated forwarding header. */
function first(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/**
 * The dashboard origin a proxy request belongs to, or null when this request must not be answered.
 *
 * Beside the dashboard, it is the origin the request itself was made to (the iframe's relative URL
 * resolved against the dashboard), honouring a reverse proxy's forwarding headers. A forged `Host`
 * changes only that request's own uncached response. With a separate proxy host, only that host
 * answers and the dashboard is the configured one.
 */
export function proxyDashboardOrigin(request: NextRequest): string | null {
  const host = first(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  if (!host || !HOST.test(host)) return null;

  const separate = separateProxyOrigin();
  if (separate) return host === new URL(separate).host ? appOrigin() : null;

  const proto =
    first(request.headers.get("x-forwarded-proto")) ?? request.nextUrl.protocol.replace(/:$/, "");
  if (proto !== "http" && proto !== "https") return null;
  return `${proto}://${host}`;
}
