/**
 * Shapes the server hands to pages and client components.
 *
 * Types only — no runtime code and no imports from `server/` or Prisma — so a client component
 * can `import type` from here without pulling anything server-side into the browser bundle.
 * Every timestamp is an ISO string rather than a `Date`, so these values survive being passed
 * as props from a Server Component to a Client Component unchanged.
 *
 * Produced by the services in `src/server/services/*`; the vocabulary (`ExperimentKind`,
 * `ExperimentStatusKey`, `Targeting`, …) is `lib/domain.ts`.
 */

import type {
  Change,
  CountingKey,
  DisplayStatusKey,
  ExperimentDraftSource,
  ExperimentKind,
  ExperimentStatusKey,
  GoalMode,
  InstallMethodKey,
  MemberRoleKey,
  MetricSummary,
  Targeting,
  Threshold,
} from "@/lib/domain";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ExperimentCounts {
  total: number;
  draft: number;
  running: number;
  paused: number;
  completed: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  /** Primary domain (`Website.domain`). */
  domain: string;
  /** Primary first, then additional domains in the order they were added. */
  domains: string[];
  protocol: "https" | "http";
  /** Favicon URL detected server-side, or null (render the initial letter). */
  iconUrl: string | null;
  publicSiteId: string;
  timezone: string;
  /** Percentage: 90, 95 or 99. */
  significanceThreshold: 90 | 95 | 99;
  /** The same as a fraction, for `lib/stats` / `lib/verdict`. */
  threshold: Threshold;
  installMethod: InstallMethodKey;
  /**
   * True once the snippet has been seen on a page (install check passed) or any tracking data
   * has arrived. Never stored as a flag — see `website.service`.
   */
  installed: boolean;
  pixelVerifiedAt: string | null;
  receivingData: boolean;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  /** Latest `updatedAt` across the project's experiments, or null with none. */
  lastActivityAt: string | null;
  counts: ExperimentCounts;
}

export interface ProjectSettings extends ProjectSummary {
  /** CDN panel — SERVICE SEAM; last time "purge" was pressed. */
  cdnPurgedAt: string | null;
}

/** Owner first (from `User`), then `ProjectMember` rows. Members grant NO access (seam). */
export interface MemberView {
  /** `ProjectMember.id`; null for the owner, who is not a member row. */
  id: string | null;
  name: string;
  email: string;
  role: MemberRoleKey;
  isOwner: boolean;
  /** Two-letter initials for the avatar. */
  initials: string;
  /** Member rows are invitations until access control exists — always true for non-owners. */
  invited: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface MetricRow extends MetricSummary {
  /** Page-visit metrics only: how `url` is compared. */
  matchType: "exact" | "starts";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export interface ArmView {
  /** 0 = control, 1… = variants. */
  position: number;
  /** `ExperimentVariant.id`; null for control. */
  variantId: string | null;
  name: string;
  color: string;
  /** Split URL: the arm's URL (control = experiment URL). A/B: "". */
  url: string;
  /** Percentage of included traffic; arms sum to 100. */
  weight: number;
  /** A/B variants only; [] otherwise. */
  changes: Change[];
}

export interface GoalView {
  mode: GoalMode;
  /** "url" for the URL goal, otherwise the metric id — the `Conversion.goalKey`. */
  key: string;
  /** Metric id when `mode` is `event`. */
  metricId: string | null;
  /** Display name: the metric's name, or "Reached /path" for a URL goal. */
  name: string;
  /** Metric event key, or the URL's path for a URL goal. */
  eventKey: string;
  /** Conversion URL for a URL goal; a page-visit metric's URL; else null. */
  url: string | null;
  match: "exact" | "starts";
}

/** Visitors and conversions for one arm over some window. */
export interface ArmTotals {
  position: number;
  /** Assigned visitors. */
  v: number;
  /** Conversions on the goal being read. */
  c: number;
}

export interface ExperimentListItem {
  id: string;
  projectId: string;
  name: string;
  type: ExperimentKind;
  status: ExperimentStatusKey;
  displayStatus: DisplayStatusKey;
  /** Control URL (Split URL) or page URL (A/B). */
  url: string;
  /** pathname + search of `url`, for compact display. */
  path: string;
  hypothesis: string;
  /** Percentage of matching traffic included, 1–100. */
  coverage: number;
  arms: ArmView[];
  goal: GoalView | null;
  counting: CountingKey;
  /** 0 = control won, n = variant n won, null = no winner / not ended. */
  winnerPosition: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  stoppedAt: string | null;
  /** Whole days since launch (inclusive of today, at least 1), or 0 when never launched. */
  daysRunning: number;
  /** All-time per-arm totals on the primary goal (unique counting). */
  totals: ArmTotals[];
  visitors: number;
  conversions: number;
}

export interface ActivityView {
  id: string;
  text: string;
  actorName: string | null;
  createdAt: string;
}

export interface ExperimentDetail extends ExperimentListItem {
  targeting: Targeting;
  secondaryMetricIds: string[];
  /** Secondary goals resolved to display form (unknown ids dropped). */
  secondaryGoals: GoalView[];
  keepWinner: boolean;
  /** True once launched: URLs, changes, targeting and goal are fixed. */
  locked: boolean;
  share: { token: string | null; sharedAt: string | null; url: string | null };
  activities: ActivityView[];
  /** Feed to `draftFromExperiment` (lib/validate-draft) to open it in the wizard. */
  draftSource: ExperimentDraftSource;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type ResultsRange = "7" | "14" | "30" | "all";

export interface DailyPoint {
  /** Assigned visitors that day. */
  v: number;
  /** Conversions that day. */
  c: number;
}

export interface ArmSeries {
  position: number;
  variantId: string | null;
  name: string;
  color: string;
  /** One point per entry of `ExperimentResults.days`. */
  daily: DailyPoint[];
  /** Window totals. */
  v: number;
  c: number;
  /** Page views and distinct page-viewing visitors in the window. */
  pageViews: number;
  pageVisitors: number;
  /** Approximate visible time (document visibility, not attention) — label it so. */
  visibleMs: number;
  avgVisibleMs: number | null;
}

export interface ExperimentResults {
  experimentId: string;
  goalKey: string;
  counting: CountingKey;
  range: ResultsRange;
  timezone: string;
  /** Project-local days `YYYY-MM-DD`, oldest first, zero-filled. Empty before launch. */
  days: string[];
  arms: ArmSeries[];
  totals: DailyPoint;
  /** Nothing at all recorded in the window. */
  isEmpty: boolean;
}

export interface GoalPerformance {
  goal: GoalView;
  primary: boolean;
  arms: ArmTotals[];
}

export interface DashboardData {
  timezone: string;
  /** Project-local days, oldest first: 30 entries (the last 28 are the previous 14 then the last 14). */
  days: string[];
  /** Project-wide assigned visitors / primary-goal conversions per day, aligned with `days`. */
  daily: DailyPoint[];
  last14: DailyPoint;
  previous14: DailyPoint;
  runningCount: number;
  /** Completed experiments whose declared winner is a variant. */
  winnersCount: number;
  /** Every experiment in the project, with all-time totals — compute verdicts with lib/stats. */
  experiments: ExperimentListItem[];
  /** Running and paused experiments, running first then by visitors. */
  live: ExperimentListItem[];
  /** Running experiments with any data (candidates for "Ready to call"), then paused ones. */
  needsDecision: ExperimentListItem[];
  /** Metrics never received (shown as "Tracking" attention items). */
  silentMetrics: MetricRow[];
}

// ---------------------------------------------------------------------------
// Seams and checks
// ---------------------------------------------------------------------------

export interface UrlCheckResult {
  ok: boolean;
  /** HTTP status of the final response, or null when nothing came back. */
  status: number | null;
  finalUrl: string | null;
  onProjectDomain: boolean;
  /** Only checked for pages on the project's domains (GET); null when not checked. */
  snippetFound: boolean | null;
  /** Human-readable explanation when `ok` is false. */
  message: string | null;
  elapsedMs: number;
}

/** CDN panel — SERVICE SEAM. Every number is a labelled placeholder; no CDN integration exists. */
export interface CdnOverview {
  placeholder: true;
  provider: string;
  sdkUrl: string;
  stats: { label: string; value: string; placeholder: true }[];
  staticRules: { asset: string; ttl: string }[];
  dynamicRules: string[];
  lastPurgedAt: string | null;
}
