/**
 * Dashboard (the design's `Main` screen) — the account overview's shapes and the pure rules
 * behind them. `dashboard.service.getAccountOverview` builds an `AccountOverview`; the view
 * renders it.
 *
 * Kept outside the `"use client"` view so the server page can read `DASHBOARD_VIEWS`: a value
 * imported from a client module arrives on the server as a client reference, not an array.
 */

import type { Checklist } from "@/lib/onboarding";
import { normalizeDomain, projectAddressError, projectNameError } from "@/lib/projects";

/**
 * `?view=` states that are purely visual. The onboarding form states open the "Add your first
 * project" dialog — they only apply to a workspace that really has no projects. Loading, error,
 * empty and "first project" now come from real data, so a URL can no longer fake them.
 */
export const DASHBOARD_VIEWS = ["data", "noProjectsCreate", "noProjectsErrors"] as const;
export type DashboardViewName = (typeof DASHBOARD_VIEWS)[number];

export type TrackStatus = "active" | "stale" | "none";

/** One row of the "Projects" card. */
export interface DashboardProject {
  id: string;
  name: string;
  domain: string;
  initial: string;
  color: string;
  ink: string;
  /** All experiments in the project. */
  experiments: number;
  /** ACTIVE experiments. */
  running: number;
  /** Drafts, paused, and running without a visitor yet. */
  needAction: number;
  track: TrackStatus;
  /** "4 min ago"; null when never seen. */
  when: string | null;
  /** Distinct visitors over the last 30 days; null when none. */
  visitors30: number | null;
  /** The last 34 daily visitor counts (oldest first); null when there were none. */
  series: number[] | null;
}

export interface AccountOverview {
  workspaceName: string;
  /** Owner/Admin: may add a project from the onboarding screen. */
  canManage: boolean;
  /** Every project in the workspace. */
  projectCount: number;
  /** Projects whose tracking status is Active. */
  trackingActive: number;
  experiments: {
    total: number;
    drafts: number;
    paused: number;
    completed: number;
    running: number;
  };
  /** Distinct projects with at least one running experiment. */
  runningProjects: number;
  /** The top projects: most running experiments, then most experiments. At most `TOP_PROJECTS`. */
  projects: DashboardProject[];
  /** The reader's role in the workspace. */
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  /** "Getting started", from the workspace's real state (`lib/onboarding.ts`). */
  checklist: Checklist;
}

/** How many projects the card lists before "View all {N} projects". */
export const TOP_PROJECTS = 5;

/** Days of series the sparkline needs: 30 points of a 5-day trailing average. */
export const SPARK_DAYS = 34;

/** Most running experiments first, then most experiments overall; ties keep their input order. */
export function rankProjects<T extends { running: number; experiments: number }>(
  rows: readonly T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        b.row.running - a.row.running || b.row.experiments - a.row.experiments || a.index - b.index,
    )
    .map(({ row }) => row);
}

/** The Experiments card caption: "2 drafts · 1 paused · 5 completed", "All running" or "None created yet". */
export function experimentsCaption(e: AccountOverview["experiments"]): string {
  if (!e.total) return "None created yet";
  const parts: string[] = [];
  if (e.drafts) parts.push(`${e.drafts} ${e.drafts === 1 ? "draft" : "drafts"}`);
  if (e.paused) parts.push(`${e.paused} paused`);
  if (e.completed) parts.push(`${e.completed} completed`);
  return parts.length ? parts.join(" · ") : "All running";
}

/**
 * The 96×18 sparkline: a 5-day trailing moving average over the last 34 days → 30 points,
 * min–max normalised (a flat series draws a mid line).
 */
export function sparkPaths(series: readonly number[]): { line: string; area: string } {
  const raw = series.slice(-SPARK_DAYS);
  const W = 96;
  const H = 18;
  const pad = 2;
  const pts =
    raw.length > 4
      ? raw.slice(4).map((_, j) => {
          const w = raw.slice(j, j + 5);
          return w.reduce((a, y) => a + y, 0) / w.length;
        })
      : [...raw];
  if (pts.length === 1) pts.push(pts[0]!);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const xy = pts.map((v, j) => {
    const px = (j / Math.max(1, pts.length - 1)) * W;
    const py = H - pad - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - pad * 2);
    return `${px.toFixed(1)} ${py.toFixed(1)}`;
  });
  const line = `M${xy.join(" L")}`;
  return { line, area: `${line} L${W} ${H} L0 ${H} Z` };
}

export function normDomain(u: string): string {
  return normalizeDomain(u);
}

/** The onboarding form's two checks — the same rules the server applies (`lib/projects.ts`). */
export function firstProjectErrors(f: { name: string; url: string }) {
  return { name: projectNameError(f.name), url: projectAddressError(f.url) };
}

export const formatCount = (n: number) => n.toLocaleString("en-US");
