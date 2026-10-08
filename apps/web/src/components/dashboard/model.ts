/**
 * The dashboard's view model (DESIGN.md §2.2, prototype `renderVals` L2718–2763): KPI strip,
 * live rows, "Needs a decision" and the title — computed from real data with `lib/stats` and
 * `lib/verdict`, so the dashboard and the results page agree about the same numbers.
 *
 * Pure: no server imports. The page builds it and hands plain rows to the components.
 */
import type { DisplayStatusKey, Threshold } from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
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

export interface LiveRow {
  id: string;
  name: string;
  type: string;
  path: string;
  day: string;
  visitors: string;
  lift: string;
  liftColor: string;
  leader: string;
  /** Chance to beat control of the best variant, or null with no data. */
  prob: number | null;
  status: DisplayStatusKey;
  href: string;
}

export interface AttentionItem {
  tag: "Ready to call" | "Paused" | "Draft" | "Tracking";
  title: string;
  body: string;
  action: string;
  href: string;
}

export interface DashboardView {
  title: string;
  sub: string;
  strip: KpiView[];
  live: LiveRow[];
  /** At most three, as designed. */
  attention: AttentionItem[];
  attentionCount: string;
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

  const live: LiveRow[] = data.live.map((e) => {
    const x = all.find((y) => y.e.id === e.id)!;
    const has = x.st.v > 0;
    const best = x.st.arms
      .slice(1)
      .reduce<(typeof x.st.arms)[number] | null>((m, a) => (!m || a.cr > m.cr ? a : m), null);
    const prob = has && best ? best.prob : null;
    return {
      id: e.id,
      name: e.name,
      type: TYPE_LABEL[e.type],
      path: e.path || pathOf(e.url),
      day: e.daysRunning ? `day ${e.daysRunning}` : "launched today",
      visitors: has ? fN(x.st.v) : "—",
      lift: prob != null && best ? fS(best.lift) : "—",
      liftColor: prob != null && best ? deltaColor(best.lift) : "#5B6579",
      leader: !has
        ? "No data yet"
        : x.vd.kind === "control"
          ? "Control leads"
          : (best?.name ?? "—"),
      prob,
      status: e.displayStatus,
      href: p.experiment(e.id),
    };
  });

  const att: AttentionItem[] = [];
  for (const x of all)
    if (x.e.status === "running" && x.vd.ready)
      att.push({
        tag: "Ready to call",
        title: x.e.name,
        body: x.vd.body,
        action: "Review & end test",
        href: p.experiment(x.e.id),
      });
  for (const x of all)
    if (x.e.status === "paused") {
      const ago = fAgo(minutesSince(x.e.updatedAt, now));
      att.push({
        tag: "Paused",
        title: x.e.name,
        body: `Paused ${ago === "Just now" ? "just now" : ago}. Visitors see Control and no data is collected.`,
        action: "Open experiment",
        href: p.experiment(x.e.id),
      });
    }
  for (const x of all)
    if (x.e.status === "draft") {
      const n = draftIncomplete[x.e.id] ?? 0;
      att.push({
        tag: "Draft",
        title: x.e.name,
        body: n
          ? `${n} setup step${n > 1 ? "s" : ""} incomplete.`
          : "Fully configured. Run QA and launch when ready.",
        action: "Continue setup",
        href: p.editExperiment(x.e.id),
      });
    }
  for (const m of data.silentMetrics)
    att.push({
      tag: "Tracking",
      title: `${m.name} metric`,
      body: `${m.key} has never been received. Experiments using it will show zero conversions.`,
      action: "Check GTM setup",
      href: p.metrics("gtm", { metric: m.id }),
    });

  const nAttE = att.filter((a) => a.tag !== "Tracking").length;
  return {
    title: nAttE
      ? `${nAttE}${nAttE === 1 ? " experiment needs" : " experiments need"} attention.`
      : "Everything is running to plan.",
    sub: ready
      ? `${ready} ready to call, the rest are still collecting data.`
      : "No experiment is ready to call yet.",
    strip,
    live,
    attention: att.slice(0, 3),
    attentionCount: att.length > 3 ? `Showing 3 of ${att.length}` : `${att.length} open`,
  };
}

export const ATTENTION_TAG: Record<AttentionItem["tag"], { bg: string; color: string }> = {
  "Ready to call": { bg: "#E6F5EE", color: "#0F7A52" },
  Paused: { bg: "#FDF3E1", color: "#94600A" },
  Draft: { bg: "#EEF0F4", color: "#4B5568" },
  Tracking: { bg: "#FCE9E6", color: "#B4361F" },
};
