/**
 * Single source of truth for every URL in the dashboard.
 *
 * Building links through these helpers instead of hand-written template strings means a route
 * rename is one edit, and typos become type errors rather than 404s at runtime.
 */

export const routes = {
  home: "/",
  login: "/login",
  getStarted: "/get-started",

  websites: {
    /** No standalone create page — a website is created from an `AddWebsiteDialog` popup
     * wherever one is needed, not by navigating anywhere. */
    detail: (websiteId: string) => `/websites/${encodeURIComponent(websiteId)}`,
  },

  /** Public, token-addressed results page. Deliberately outside the protected prefixes. */
  share: (token: string) => `/share/${encodeURIComponent(token)}`,

  /** Where a customer connects Google Sheets and sees the daily sync's history.
   *
   * A plain string rather than a namespace: there is exactly one integration, so this page *is*
   * the Google Sheets page. When a second one exists, this becomes the list and the Sheets page
   * moves to `/integrations/google-sheets` — which is one edit here, and nowhere else. */
  integrations: "/integrations",

  /** Conversion goals across every experiment, viewed as a list of measurable actions. */
  metrics: {
    list: "/metrics",
    /** A goal's setup page. Addressed by its experiment, because a goal has no id of its own. */
    detail: (experimentId: string) => `/metrics/${encodeURIComponent(experimentId)}`,
  },

  experiments: {
    /** The experiments list — also where the app lands a signed-in visitor with no more
     * specific destination, now that there is no separate dashboard route. */
    list: "/experiments",
    new: (websiteId?: string) =>
      websiteId
        ? `/experiments/new?websiteId=${encodeURIComponent(websiteId)}`
        : "/experiments/new",
    detail: (experimentId: string) => `/experiments/${encodeURIComponent(experimentId)}`,
  },
} as const;

/**
 * Where a signed-in visitor lands when they had no particular destination.
 *
 * Named once, and referenced everywhere that decision is made — after signing in, on `/`, and
 * as the fallback in the Auth.js redirect guard. Those four sites drifted apart the last time
 * a route was renamed, which is the whole reason this file exists.
 *
 * An explicit `?callbackUrl=` still wins: someone who was stopped on the way to a specific page
 * should be returned there, not deposited on the landing page having forgotten why they came.
 */
export const AFTER_SIGN_IN: string = routes.getStarted;

/** Route prefixes that require an authenticated session. */
export const PROTECTED_PREFIXES = [
  "/get-started",
  "/websites",
  "/experiments",
  "/metrics",
  "/integrations",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
