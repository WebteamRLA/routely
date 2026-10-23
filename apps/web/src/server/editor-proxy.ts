import "server-only";

import { env } from "@/env";

/**
 * The origin the visual editor's page proxy is served from, or null when the proxy is off.
 *
 * Never the dashboard's own origin: a proxied page runs the customer's scripts, and on the app's
 * origin those could read its pages with the signed-in user's cookies. A separate origin gets no
 * cookies (Auth.js cookies are host-only) and no same-origin access to the dashboard.
 *
 * `EDITOR_PROXY_ORIGIN` when set; in development, the app's host swapped between `localhost` and
 * `127.0.0.1` (two origins served by the same dev server); otherwise null — production then opens
 * sites that forbid framing in a popup.
 */
export function editorProxyOrigin(): string | null {
  const app = new URL(env.NEXT_PUBLIC_APP_URL);
  let origin: string | null = null;
  if (env.EDITOR_PROXY_ORIGIN) {
    origin = new URL(env.EDITOR_PROXY_ORIGIN).origin;
  } else if (env.NODE_ENV !== "production") {
    const swapped = new URL(app.origin);
    if (app.hostname === "localhost") swapped.hostname = "127.0.0.1";
    else if (app.hostname === "127.0.0.1") swapped.hostname = "localhost";
    else return null;
    origin = swapped.origin;
  }
  return origin && origin !== app.origin ? origin : null;
}

/** The dashboard's own origin, which the proxied page's snippet talks to. */
export function appOrigin(): string {
  return new URL(env.NEXT_PUBLIC_APP_URL).origin;
}
