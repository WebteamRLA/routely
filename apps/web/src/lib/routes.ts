/**
 * Single source of truth for every URL in the dashboard.
 *
 * Building links through these helpers instead of hand-written template strings means a route
 * rename is one edit, and typos become type errors rather than 404s at runtime.
 *
 * The UI says "project" where the database says "website"; `projectId` is `Website.id`.
 */

type Query = Record<string, string | number | null | undefined>;

/** Appends the defined, non-empty entries of `query` as a search string. */
function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

const enc = encodeURIComponent;

export type ExperimentDetailTab = "results" | "setup" | "activity";
export type MetricsTab = "metrics" | "gtm";
export type IntegrationsTab = "sheets" | "cdn";
export type SettingsTab = "project" | "install" | "team";

export interface ExperimentListQuery {
  status?: "all" | "draft" | "running" | "paused" | "completed";
  type?: "all" | "redirect" | "ab";
  q?: string;
  sort?: string;
}

export interface ExperimentDetailQuery {
  tab?: ExperimentDetailTab;
  range?: "7" | "14" | "30" | "all";
  /** Goal key: `url` or a metric id. */
  goal?: string;
  metric?: string;
}

/** Every page under one project. */
function projectRoutes(projectId: string) {
  const base = `/p/${enc(projectId)}`;
  return {
    /** The project dashboard. */
    dashboard: base,
    experiments: (query?: ExperimentListQuery) =>
      withQuery(`${base}/experiments`, query as Query | undefined),
    experiment: (experimentId: string, query?: ExperimentDetailQuery) =>
      withQuery(`${base}/experiments/${enc(experimentId)}`, query as Query | undefined),
    newExperiment: (type?: "redirect" | "ab", step?: string) =>
      withQuery(`${base}/experiments/new`, { type, step }),
    editExperiment: (experimentId: string, step?: string) =>
      withQuery(`${base}/experiments/${enc(experimentId)}/edit`, { step }),
    metrics: (tab?: MetricsTab, query?: { metric?: string }) =>
      withQuery(`${base}/metrics`, { tab: tab === "metrics" ? undefined : tab, ...query }),
    integrations: (tab?: IntegrationsTab) =>
      withQuery(`${base}/integrations`, { tab: tab === "sheets" ? undefined : tab }),
    settings: (tab: SettingsTab = "project") => `${base}/settings/${tab}`,
  } as const;
}

export const routes = {
  home: "/",
  login: "/login",

  /** Manage projects. */
  projects: "/projects",
  /** Pages scoped to one project: `routes.project(id).experiments()` etc. */
  project: projectRoutes,

  /** Public, token-addressed results page. Deliberately outside the protected prefixes. */
  share: (token: string) => `/share/${enc(token)}`,

  /**
   * The legacy `/integrations` path, now a redirect page that forwards (query string kept) to the
   * current project's Integrations. For server redirects that know no project id, e.g. the Google
   * OAuth callback when the `rl_project` cookie is absent.
   */
  currentIntegrations: "/integrations",
} as const;

/**
 * Where a signed-in visitor lands when they had no particular destination.
 *
 * Named once, and referenced everywhere that decision is made — after signing in, on `/`, and
 * as the fallback in the Auth.js redirect guard.
 *
 * `/` picks the last-used project (cookie `rl_project`), else the first active one, else
 * Manage projects — so landing there is always the right place after signing in.
 */
export const AFTER_SIGN_IN: string = routes.home;

/** Route prefixes that require an authenticated session. */
export const PROTECTED_PREFIXES = [
  "/p",
  "/projects",
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

/** Cookie remembering the last project a user opened, so `/` can return them to it. */
export const LAST_PROJECT_COOKIE = "rl_project";
