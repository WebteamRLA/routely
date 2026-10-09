/**
 * The dashboard's view model: KPI strip, the Experiments table (with each row's needs-action
 * reason), the conversions breakdown and the 30-day visitor series — computed from real data
 * with `lib/stats` and `lib/verdict`, so the dashboard and the results page agree about the
 * same numbers.
 *
 * Pure: no server imports. The page builds it and hands plain rows to the components.
 */
import type { DisplayStatusKey, Threshold } from "@/lib/domain";
import { fAgo, fN, fP, fS, minutesSince } from "@/lib/format";
import { routes } from "@/lib/routes";
import { computeStats, type ExperimentStats } from "@/lib/stats";
import { TYPE_LABEL, verdict, type Verdict } from "@/lib/verdict";
import type { DailyPoint, DashboardData, ExperimentListItem } from "@/lib/view-models";

export interface KpiView {
  label: string;
  value: string;
  delta: string;
  deltaColor: string;
  sub: string;
  href: string;
}

/** Which tab of the Experiments section a row appears under. */
export type ExperimentTab = "all" | "running" | "action";

/** One row of the dashboard's Experiments table. */
export interface ExperimentRow {
  id: string;
  name: string;
  /** Letter tile: initial and a colour stable for this experiment. */
  initial: string;
  tileColor: string;
  status: DisplayStatusKey;
  /** "Running · day 42", "Paused · 3h ago", "Draft · updated 2h ago". */
  statusLine: string;
  typeLabel: string;
  /** Why this experiment needs a decision, or null. */
  needsAction: string | null;
  /** Tone of the needs-action reason. */
  actionTone: "good" | "warn" | "bad" | "neutral";
  visitors: string;
  variantsLabel: string;
  /** Share of the listed experiments' assigned visitors, 0–1. */
  share: number;
  shareLabel: string;
  conversionRate: string;
  /** Verdict in a few words, or "no result yet". */
  resultLabel: string;
  resultColor: string;
  /** The row button: "Review", "Continue" or "View". */
  actionLabel: string;
  actionHref: string;
  href: string;
  running: boolean;
}

/** A running experiment's slice of the "Conversions by running experiment" chart. */
export interface ConversionSlice {
  id: string;
  name: string;
  color: string;
  conversions: number;
}

export interface VisitorPoint {
  /** Project-local day, YYYY-MM-DD. */
  day: string;
  visitors: number;
}

export interface DashboardView {
  title: string;
  sub: string;
  strip: KpiView[];
  rows: ExperimentRow[];
  counts: Record<ExperimentTab, number>;
  conversions: ConversionSlice[];
  visitors: VisitorPoint[];
}

/** Tile colours: the arm palette plus navy, so tiles stay on brand. */
const TILE_COLORS = ["#2B59F0", "#F0603F", "#11A08F", "#B7860B", "#0A1633", "#7C879C"];
function tileColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length]!;
}

const GOOD = "#0F7A52";
const BAD = "#B4361F";

/** Stats over an experiment's all-time per-arm totals (arms in position order). */
export function statsOf(e: ExperimentListItem): ExperimentStats {
  const arms = [...e.arms].sort((a, b) => a.position - b.position);
  return computeStats(
    arms.map((a) => {
      const t = e.totals.find((x) => x.position === a.position);
      return { name: a.name, v: t?.v ?? 0, c: t?.c ?? 0 };
    }),
  );
}

const sum = (points: DailyPoint[]) =>
  points.reduce((t, p) => ({ v: t.v + p.v, c: t.c + p.c }), { v: 0, c: 0 });
const change = (a: number, b: number) => (b ? (a - b) / b : 0);
const arrow = (x: number) => `${x >= 0 ? "▲" : "▼"} ${Math.abs(x * 100).toFixed(1)}%`;
const deltaColor = (x: number) => (x >= 0 ? GOOD : BAD);

export function buildDashboard(
  projectId: string,
  data: DashboardData,
  threshold: Threshold,
  /** Draft id → number of wizard steps with validation errors. */
  draftIncomplete: Record<string, number>,
  now: Date = new Date(),
): DashboardView {
  const p = routes.project(projectId);
  const all = data.experiments.map((e) => {
    const st = statsOf(e);
    return { e, st, vd: verdict(e.status, e.winnerPosition, st, threshold) as Verdict };
  });
  const ready = all.filter((x) => x.e.status === "running" && x.vd.ready).length;

  // Deltas: last 7 days vs the 7 before, inside the 14-day window (as the prototype).
  const last7 = sum(data.daily.slice(-7));
  const prev7 = sum(data.daily.slice(-14, -7));
  const dv = change(last7.v, prev7.v);
  const dcr = change(last7.v ? last7.c / last7.v : 0, prev7.v ? prev7.c / prev7.v : 0);
  const wins = all.filter(
    (x) => x.e.status !== "draft" && x.vd.kind === "win" && x.vd.leader && x.vd.leader.i > 0,
  );
  const avgLift = wins.length
    ? wins.reduce((t, x) => t + (x.vd.leader?.lift ?? 0), 0) / wins.length
    : 0;
  const { v: tv, c: tc } = data.last14;

  const strip: KpiView[] = [
    {
      label: "Running now",
      value: String(data.runningCount),
      delta: "",
      deltaColor: "#0F1B35",
      sub: `${ready} ready to call`,
      href: p.experiments({ status: "running" }),
    },
    {
      label: "Visitors · 14d",
      value: fN(tv),
      delta: arrow(dv),
      deltaColor: deltaColor(dv),
      sub: "vs last week",
      href: p.experiments({ sort: "visitors" }),
    },
    {
      label: "Conv. rate · 14d",
      value: tv ? fP(tc / tv, 2) : "—",
      delta: arrow(dcr),
      deltaColor: deltaColor(dcr),
      sub: "vs last week",
      href: p.experiments({ sort: "cr" }),
    },
    {
      label: "Winners",
      value: String(wins.length),
      delta: wins.length ? fS(avgLift) : "",
      deltaColor: GOOD,
      sub: wins.length ? "average lift" : "none significant yet",
      href: p.experiments({ status: "completed" }),
    },
  ];

  // The table lists everything not yet finished: running, then paused, then drafts.
  const order: Record<string, number> = { running: 0, paused: 1, draft: 2 };
  const listed = all
    .filter((x) => x.e.status !== "completed")
    .sort(
      (a, b) =>
        order[a.e.status]! - order[b.e.status]! ||
        b.e.visitors - a.e.visitors ||
        b.e.updatedAt.localeCompare(a.e.updatedAt),
    );
  const listedVisitors = listed.reduce((t, x) => t + x.st.v, 0);
  const silent = new Set(data.silentMetrics.map((m) => m.id));

  const rows: ExperimentRow[] = listed.map(({ e, st, vd }) => {
    const has = st.v > 0;
    const best = st.arms
      .slice(1)
      .reduce<(typeof st.arms)[number] | null>((m, a) => (!m || a.cr > m.cr ? a : m), null);
    const variants = e.arms.length - 1;
    const ago = fAgo(minutesSince(e.updatedAt, now)).toLowerCase();

    let needsAction: string | null = null;
    let actionTone: ExperimentRow["actionTone"] = "neutral";
    let actionLabel = "View";
    let actionHref = p.experiment(e.id);
    if (e.status === "running" && vd.ready) {
      needsAction = vd.kind === "control" ? "Control is winning" : "Ready to call";
      actionTone = "good";
      actionLabel = "Review";
    } else if (e.status === "running" && e.goal?.metricId && silent.has(e.goal.metricId)) {
      needsAction = "Goal never received";
      actionTone = "bad";
      actionLabel = "Check tracking";
      actionHref = p.metrics("gtm", { metric: e.goal.metricId });
    } else if (e.status === "running" && !has) {
      needsAction = "No traffic";
      actionTone = "warn";
      actionLabel = "Review";
    } else if (e.status === "paused") {
      needsAction = "Paused";
      actionTone = "warn";
      actionLabel = "Review";
    } else if (e.status === "draft") {
      const n = draftIncomplete[e.id] ?? 0;
      needsAction = n ? `${n} setup step${n > 1 ? "s" : ""} left` : "Ready to launch";
      actionTone = n ? "neutral" : "good";
      actionLabel = "Continue";
      actionHref = p.editExperiment(e.id);
    }

    const statusLine =
      e.status === "running"
        ? `Running · ${e.daysRunning ? `day ${e.daysRunning}` : "launched today"}`
        : e.status === "paused"
          ? `Paused · ${ago}`
          : `Draft · updated ${ago}`;

    return {
      id: e.id,
      name: e.name,
      initial: e.name.trim().charAt(0).toUpperCase() || "?",
      tileColor: tileColor(e.id),
      status: e.displayStatus,
      statusLine,
      typeLabel: TYPE_LABEL[e.type],
      needsAction,
      actionTone,
      visitors: fN(st.v),
      variantsLabel: `${variants} variant${variants === 1 ? "" : "s"}`,
      share: listedVisitors ? st.v / listedVisitors : 0,
      shareLabel: fP(listedVisitors ? st.v / listedVisitors : 0, 0),
      conversionRate: has ? fP(st.c / st.v, 2) : "—",
      resultLabel:
        e.status === "draft"
          ? "not launched"
          : !has
            ? "no result yet"
            : vd.kind === "early" && best && best.prob != null
              ? `${vd.short} · ${Math.round(best.prob * 100)}%`
              : vd.short,
      resultColor: !has
        ? "#5B6579"
        : vd.tone === "good"
          ? GOOD
          : vd.tone === "bad"
            ? BAD
            : "#4B5568",
      actionLabel,
      actionHref,
      href: p.experiment(e.id),
      running: e.status === "running",
    };
  });

  const conversions: ConversionSlice[] = all
    .filter((x) => x.e.status === "running")
    .map((x) => ({ id: x.e.id, name: x.e.name, color: tileColor(x.e.id), conversions: x.st.c }))
    .sort((a, b) => b.conversions - a.conversions);

  const nAction = rows.filter((r) => r.needsAction).length;
  return {
    title: nAction
      ? `${nAction}${nAction === 1 ? " experiment needs" : " experiments need"} attention.`
      : "Everything is running to plan.",
    sub: ready
      ? `${ready} ready to call, the rest are still collecting data.`
      : "No experiment is ready to call yet.",
    strip,
    rows,
    counts: {
      all: rows.length,
      running: rows.filter((r) => r.running).length,
      action: nAction,
    },
    conversions,
    visitors: data.days.map((day, i) => ({ day, visitors: data.daily[i]?.v ?? 0 })),
  };
}
