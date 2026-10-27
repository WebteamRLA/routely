/**
 * Project dashboard — the shapes `/projects/[projectId]` renders and the pure rules that derive
 * them from stored rows: each experiment row's status line, needs-action, action, note and
 * order. `project-dashboard.service.ts` gathers the rows; everything that decides what a row
 * *says* lives here so it can be tested without a database.
 *
 * Pure (imports only other pure `lib/` modules): client components import the types.
 */

import { dayNumber, formatMonthDay, isJustNow } from "@/lib/experiment-time";
import type { LaunchSummary } from "@/lib/launch-rules";
import { routes } from "@/lib/routes";
import {
  type ArmCounts,
  type WinnerDecision,
  analyzeResults,
  resultNote,
  resultStatusOf,
} from "@/lib/verdict";

/**
 * `?view=` states that are purely visual — a dialog or menu open, a filter preset. Loading,
 * error, the Sheets connection states and verification results come from real data now, so a URL
 * can no longer fake them.
 */
export const PD_VIEWS = [
  "default",
  "pixelSetup",
  "pixelVerify",
  "launchConfirm",
  "filtered",
  "filterNone",
  "sheetsPanel",
  "sheetsCreate",
] as const;
export type PdView = (typeof PD_VIEWS)[number];

export interface PdProject {
  id: string;
  name: string;
  domain: string;
  protocol: "HTTPS" | "HTTP";
  initial: string;
  color: string;
  ink: string;
  /** Public site id — the "Project ID" in the snippet. */
  key: string;
  /** "Mar 4, 2025" */
  created: string;
  /** "Alex Morgan"; "a former member" when the creator's account is gone. */
  by: string;
}

export type ExpType = "ab" | "split";
export type ExpStatus = "running" | "paused" | "draft" | "completed";
export type ExpAction = "Review" | "Launch" | "Continue" | "View results";

/** The launch confirm's facts — `lib/launch-rules.ts`'s summary. */
export type LaunchInfo = LaunchSummary;

export interface PdExperiment {
  id: string;
  name: string;
  type: ExpType;
  status: ExpStatus;
  /** "· day N" for running and paused. */
  day?: number;
  /** "· ended Sep 18" for completed. */
  ended?: string;
  /** Launched under a minute ago: "· launched just now". */
  justLaunched?: boolean;
  /** count(assignments), every arm. */
  visitors: number;
  /** count(conversions), every arm. */
  conversions: number;
  /** Arms including Control: 1 + variants. */
  variants: number;
  /** `trafficAllocation` while running, else 0. */
  share: number;
  /** Pooled conversion rate in percent (3.8), or null with no visitors. */
  rate: number | null;
  /** `lib/verdict.ts` `resultNote(…, "project")`. */
  note: string;
  need: string | null;
  action: ExpAction;
  /** Where the action goes; null for Launch, which opens the confirm dialog in place. */
  href: string | null;
  /** The confirm dialog's facts, for a draft that is ready to launch. */
  launch?: LaunchInfo;
}

export interface ProjectPermissions {
  /** Edit / delete the project (Owner, Admin). */
  manageProject: boolean;
  /** Create, launch, pause experiments (Editor+) — and delete drafts. */
  editExperiments: boolean;
  /** Delete an experiment in any status, with its results (Owner, Admin). */
  deleteExperiments: boolean;
  /** Run the install check (Editor+). */
  verifyPixel: boolean;
}

/** The part of the page loaded before anything streams (it is also the access check). */
export interface ProjectHeader {
  project: PdProject;
  pixel: PixelBase;
  permissions: ProjectPermissions;
  /** The SDK URL the install snippet points at (`env.SDK_URL`). */
  sdkUrl: string;
}

export interface ProjectVisitors {
  /** 90 UTC days, oldest first, zero-filled. */
  days: VisitorDay[];
  /** Distinct visitors over the last 7 / 30 / 90 days (30 = `visitors30`). */
  totals: { 7: number; 30: number; 90: number };
}

/** "New experiment" from a project: the wizard, with the project preselected. */
export function newExperimentHref(type: ExpType, projectId: string): string {
  return routes.experiments.wizard(type === "ab" ? "AB_TEST" : "SPLIT_URL", undefined, projectId);
}

export type PixelStatus = "active" | "stale" | "none";

export interface PixelBase {
  status: PixelStatus;
  /** "4 min ago" — empty when never seen. */
  when: string;
  /** "Sep 19, 2026" */
  since?: string;
}

/** One day of the visitors chart: a UTC day key and its count. */
export interface VisitorDay {
  /** `YYYY-MM-DD` (UTC). */
  day: string;
  v: number;
}

/** A chart point, with the day as a local-midnight `Date` so labels read the UTC day as written. */
export interface DayPoint {
  d: Date;
  v: number;
}

/** `YYYY-MM-DD` → a local-midnight Date for that calendar day (never shifted by the viewer's zone). */
export function dayPoints(days: readonly VisitorDay[]): DayPoint[] {
  return days.map(({ day, v }) => {
    const [y, m, d] = day.split("-").map(Number);
    return { d: new Date(y!, (m ?? 1) - 1, d ?? 1), v };
  });
}

export const fmt = (n: number) => Number(n).toLocaleString("en-US");

// ---------------------------------------------------------------------------------------------
// Row derivation
// ---------------------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a row is derived from: the stored experiment plus its per-arm counts. */
export interface ExperimentRowInput {
  id: string;
  name: string;
  type: "SPLIT_URL" | "AB_TEST";
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  trafficAllocation: number;
  publishedAt: Date | null;
  /** PAUSED: the last pause. The day count stops there, as on the experiment's own page. */
  pausedAt?: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
  /** Control first, then variants in position order. */
  arms: ArmCounts[];
  /** The chosen winner (`storedDecision`), when one was chosen. */
  decision?: Pick<WinnerDecision, "armIndex" | "basis"> | null;
  /** DRAFT only: steps 1–4 are complete (`lib/launch-rules.ts` `isSetupComplete`). */
  setupComplete: boolean;
  /** DRAFT and complete: the confirm dialog's facts. */
  launch?: LaunchInfo;
}

/** A row plus the timestamps its order is decided by. */
export interface DerivedRow {
  row: PdExperiment;
  publishedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
}

/** Name to show — a draft may still be unnamed. */
export function displayName(name: string): string {
  return name.trim() || "Untitled experiment";
}

/**
 * Needs action and the row's action:
 *
 * | Condition                                  | Need               | Action       |
 * |--------------------------------------------|--------------------|--------------|
 * | PAUSED                                     | "Paused"           | Review       |
 * | ACTIVE, 0 assigned, launched < 24 h ago    | "Awaiting traffic" | Review       |
 * | ACTIVE, 0 assigned, launched ≥ 24 h ago    | "No traffic"       | Review       |
 * | DRAFT, setup complete                      | "Not launched"     | Launch       |
 * | DRAFT, setup incomplete                    | "Setup incomplete" | Continue     |
 * | otherwise                                  | —                  | View results |
 */
export function needAndAction(
  input: Pick<ExperimentRowInput, "status" | "publishedAt" | "setupComplete">,
  visitors: number,
  now: Date,
): { need: string | null; action: ExpAction } {
  if (input.status === "PAUSED") return { need: "Paused", action: "Review" };
  if (input.status === "ACTIVE" && visitors === 0) {
    const fresh = !input.publishedAt || now.getTime() - input.publishedAt.getTime() < DAY_MS;
    return { need: fresh ? "Awaiting traffic" : "No traffic", action: "Review" };
  }
  if (input.status === "DRAFT") {
    return input.setupComplete
      ? { need: "Not launched", action: "Launch" }
      : { need: "Setup incomplete", action: "Continue" };
  }
  return { need: null, action: "View results" };
}

/** Where a row's action leads. Launch has no link: it opens the confirm dialog in place. */
export function actionHref(id: string, type: ExpType, action: ExpAction): string | null {
  if (action === "Launch") return null;
  if (action === "Continue")
    return routes.experiments.wizard(type === "ab" ? "AB_TEST" : "SPLIT_URL", id);
  if (action === "Review") return `${routes.experiments.detail(id)}?view=review`;
  return routes.experiments.detail(id);
}

export function deriveExperimentRow(input: ExperimentRowInput, now: Date): DerivedRow {
  const status = resultStatusOf(input.status);
  const type: ExpType = input.type === "AB_TEST" ? "ab" : "split";
  const analysis = analyzeResults(input.arms);
  const { need, action } = needAndAction(input, analysis.totalVisitors, now);

  const row: PdExperiment = {
    id: input.id,
    name: displayName(input.name),
    type,
    status,
    visitors: analysis.totalVisitors,
    conversions: analysis.totalConversions,
    variants: input.arms.length,
    share: input.status === "ACTIVE" ? input.trafficAllocation : 0,
    rate: analysis.pooledRate === null ? null : analysis.pooledRate * 100,
    note: resultNote(analysis, status, "project", input.decision ?? null),
    need,
    action,
    href: actionHref(input.id, type, action),
  };

  if ((status === "running" || status === "paused") && input.publishedAt) {
    row.day = dayNumber(input.publishedAt, status === "paused" ? (input.pausedAt ?? now) : now);
  }
  if (status === "running" && input.publishedAt && isJustNow(input.publishedAt, now)) {
    row.justLaunched = true;
  }
  if (status === "completed" && input.endedAt) row.ended = formatMonthDay(input.endedAt);
  if (action === "Launch" && input.launch) row.launch = input.launch;

  return {
    row,
    publishedAt: input.publishedAt,
    endedAt: input.endedAt,
    updatedAt: input.updatedAt,
  };
}

/** Within "needs action": paused, then running without traffic, then ready drafts, then the rest. */
const NEED_RANK: Record<string, number> = {
  Paused: 0,
  "No traffic": 1,
  "Awaiting traffic": 2,
  "Not launched": 3,
  "Setup incomplete": 4,
};

const time = (d: Date | null) => (d ? d.getTime() : 0);

/**
 * Display order: needs-action rows first, then running by launch (newest first), then completed
 * by end (newest first), then any other draft by last edit (newest first). Stable on ties.
 */
export function sortExperimentRows(rows: readonly DerivedRow[]): PdExperiment[] {
  const group = (r: DerivedRow) =>
    r.row.need
      ? 0
      : r.row.status === "running" || r.row.status === "paused"
        ? 1
        : r.row.status === "completed"
          ? 2
          : 3;

  return [...rows]
    .map((r, index) => ({ r, index }))
    .sort((a, b) => {
      const ga = group(a.r);
      const gb = group(b.r);
      if (ga !== gb) return ga - gb;
      let diff = 0;
      if (ga === 0) {
        diff =
          (NEED_RANK[a.r.row.need!] ?? 9) - (NEED_RANK[b.r.row.need!] ?? 9) ||
          time(b.r.updatedAt) - time(a.r.updatedAt);
      } else if (ga === 1) diff = time(b.r.publishedAt) - time(a.r.publishedAt);
      else if (ga === 2) diff = time(b.r.endedAt) - time(a.r.endedAt);
      else diff = time(b.r.updatedAt) - time(a.r.updatedAt);
      return diff || a.index - b.index;
    })
    .map(({ r }) => r.row);
}

/** Whether an experiment counts toward "need action" — every draft, every paused, and running without traffic. */
export function needsAction(status: ExperimentRowInput["status"], hasTraffic: boolean): boolean {
  return status === "DRAFT" || status === "PAUSED" || (status === "ACTIVE" && !hasTraffic);
}
