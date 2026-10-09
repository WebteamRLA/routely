/**
 * View shaping for the results screens (detail page and public share page). Pure and
 * client-safe: everything here is derived from the `ExperimentResults` the server returns plus
 * the experiment's arms, using `lib/stats` and `lib/verdict` for the maths.
 */

import type { ExperimentKind, ExperimentStatusKey } from "@/lib/domain";
import { fDate, fN, fP } from "@/lib/format";
import { statsFromDaily, type ExperimentStats } from "@/lib/stats";
import type { ArmView, ExperimentResults, GoalView } from "@/lib/view-models";

/** What the results view needs to know about the experiment itself. */
export interface ResultsMeta {
  status: ExperimentStatusKey;
  type: ExperimentKind;
  winnerPosition: number | null;
  arms: ArmView[];
  coverage: number;
  /** Significance threshold as a fraction (0.9 / 0.95 / 0.99). */
  threshold: number;
  /** Primary goal first, then secondary goals. */
  goals: GoalView[];
}

export type ChartMetric = "cr" | "visitors" | "conversions";

/** Day key `YYYY-MM-DD` (project-local) → "Oct 8". */
export function dayLabel(day: string): string {
  return fDate(`${day}T00:00:00Z`);
}

/** Per-arm stats over the server's window (already narrowed to the selected range). */
export function resultsStats(meta: ResultsMeta, results: ExperimentResults): ExperimentStats {
  const byPosition = new Map(meta.arms.map((a) => [a.position, a]));
  const ordered = [...results.arms].sort((a, b) => a.position - b.position);
  return statsFromDaily(
    ordered.map((a) => {
      const arm = byPosition.get(a.position);
      return {
        name: a.name,
        weight: arm?.weight ?? 0,
        url: arm?.url ?? "",
        changes: arm?.changes ?? [],
      };
    }),
    ordered.map((a) => a.daily),
    "all",
  );
}

/** "Sep 21 – Oct 8" for the window, or "" before any day exists. */
export function rangeText(results: ExperimentResults): string {
  const first = results.days[0];
  const last = results.days[results.days.length - 1];
  return first && last ? `${dayLabel(first)} – ${dayLabel(last)}` : "";
}

export interface ChartModel {
  /** SVG paths in a 600×200 viewBox. */
  series: { color: string; d: string; pts: number[] }[];
  yTicks: { label: string; top: string }[];
  xLabels: string[];
  /** One label per point. */
  dates: string[];
  legend: { name: string; color: string; val: string }[];
  /** Points per series. */
  n: number;
  format: (v: number) => string;
}

/** Cumulative series per arm, with the prototype's axis padding and tick placement. */
export function chartModel(
  results: ExperimentResults,
  stats: ExperimentStats,
  metric: ChartMetric,
): ChartModel | null {
  const days = results.days;
  if (!days.length) return null;
  const ordered = [...results.arms].sort((a, b) => a.position - b.position);
  const raw = ordered.map((arm) => {
    let cv = 0;
    let cc = 0;
    const pts = arm.daily.map((d) => {
      cv += d.v;
      cc += d.c;
      return metric === "cr" ? (cv ? cc / cv : 0) : metric === "visitors" ? cv : cc;
    });
    if (pts.length === 1) pts.push(pts[0]!);
    return { pts, color: arm.color };
  });
  const flat = raw.flatMap((x) => x.pts);
  let lo = Math.min(...flat);
  let hi = Math.max(...flat);
  if (metric !== "cr") lo = 0;
  else {
    const pad = (hi - lo) * 0.15 || hi * 0.1 || 0.01;
    lo = Math.max(0, lo - pad);
    hi = hi + pad;
  }
  if (hi === lo) hi = lo + 1;
  const n = raw[0]?.pts.length ?? 0;
  const Y = (v: number) => 195 - ((v - lo) / (hi - lo)) * 185;
  const format = (v: number) => (metric === "cr" ? fP(v, 2) : fN(v));
  const series = raw.map((x) => ({
    color: x.color,
    pts: x.pts,
    d: x.pts
      .map((p, j) => (j ? "L" : "M") + ((j / (n - 1)) * 600).toFixed(1) + "," + Y(p).toFixed(1))
      .join(" "),
  }));
  const yTicks = [0, 1, 2, 3].map((k) => {
    const v = lo + ((hi - lo) * (3 - k)) / 3;
    return {
      label: metric === "cr" ? fP(v, 1) : fN(v),
      top: ((Y(v) / 200) * 100).toFixed(1) + "%",
    };
  });
  const dates = Array.from({ length: n }, (_, j) => dayLabel(days[Math.min(j, days.length - 1)]!));
  const xn = Math.min(6, n);
  const xLabels = Array.from(
    { length: xn },
    (_, k) => dates[Math.round((k * (n - 1)) / Math.max(1, xn - 1))]!,
  );
  const legend = series.map((x, i) => ({
    name: stats.arms[i]?.name ?? "",
    color: x.color,
    val: format(x.pts[x.pts.length - 1] ?? 0),
  }));
  return { series, yTicks, xLabels, dates, legend, n, format };
}

/** Colour for a chance-to-beat-control value against the threshold. */
export function liftColor(lift: number): string {
  return lift >= 0 ? "#0F7A52" : "#B4361F";
}

export interface ArmBadge {
  label: "Winner" | "Winning" | "Leading";
  /** `Tag` tone: blue for Leading, red when Control wins, green for a winning variant. */
  tone: "blue" | "red" | "green";
}

/**
 * The badge an arm wears in the scorecards and comparison table (prototype `dx.rows`):
 * Winner when completed and declared; Winning for the running leader past the threshold
 * (either way); Leading for a variant ahead while it is still too early.
 */
export function armBadge(
  position: number,
  lift: number,
  status: ExperimentStatusKey,
  winnerPosition: number | null,
  verdictKind: string,
  leaderPosition: number | null,
): ArmBadge | null {
  const completed = status === "completed";
  let label: ArmBadge["label"] | null = null;
  if (completed && winnerPosition === position) label = "Winner";
  else if (
    !completed &&
    leaderPosition === position &&
    (verdictKind === "win" || verdictKind === "control")
  )
    label = "Winning";
  else if (
    !completed &&
    leaderPosition === position &&
    position > 0 &&
    verdictKind === "early" &&
    lift > 0
  )
    label = "Leading";
  if (!label) return null;
  if (label === "Leading") return { label, tone: "blue" };
  if (position === 0) return { label, tone: "red" };
  return { label, tone: "green" };
}
