/**
 * Results statistics: a two-proportion z-test of each variant against control.
 *
 * Verbatim maths from the design prototype's `stats()`, run on real counts instead of the
 * prototype's generated data:
 *
 *   se    = √( p0(1−p0)/n0 + p1(1−p1)/n1 )      (unpooled; n floored at 1)
 *   lift  = (p1 − p0) / p0                       (0 when p0 = 0)
 *   prob  = Φ((p1 − p0) / se), clamped to [0.006, 0.994]; 0.5 when se = 0
 *   lo/hi = (p1 − p0 ∓ 1.96·se) / p0             (95% CI of the lift; 0 when p0 = 0)
 *   p     = 2(1 − Φ(|p1 − p0| / se)); 1 when se = 0
 *
 * `v` is visitors assigned to the arm and `c` the converting count (conversion rate is
 * c ÷ assigned visitors, the denominator documented in CLAUDE.md).
 */

import { armColor, type Change } from "./domain";

/** Standard normal CDF (Abramowitz–Stegun 26.2.17 polynomial, as in the prototype). */
export function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export interface ArmCounts {
  name: string;
  /** Assigned visitors. */
  v: number;
  /** Conversions. */
  c: number;
  weight?: number;
  url?: string;
  changes?: Change[];
}

export interface ArmStat extends ArmCounts {
  /** Position: 0 = control. */
  i: number;
  color: string;
  /** Conversion rate c ÷ v (0 with no visitors). */
  cr: number;
  /** Relative change in cr vs control; 0 for control. */
  lift: number;
  /** Chance to beat control; null for control. */
  prob: number | null;
  /** 95% CI of the lift; null for control. */
  lo: number | null;
  hi: number | null;
  /** Two-sided p-value; null for control. */
  p: number | null;
}

export interface ExperimentStats {
  arms: ArmStat[];
  /** Index of the first day in the window, and days of data in total (from `sliceDaily`). */
  start: number;
  days: number;
  /** Days in the window. Used by the verdict to estimate days remaining. */
  n: number;
  /** Totals across arms. */
  v: number;
  c: number;
}

/**
 * Per-visitor variance of a conversion rate. Binomial `p(1 − p)` for a rate of at most one; with
 * counting mode ALL a rate can exceed one (conversions per visitor), where the binomial term
 * goes negative and every interval becomes NaN — so the Poisson variance (the rate itself) is
 * used there instead.
 */
export function rateVariance(cr: number): number {
  return cr > 1 ? cr : cr * (1 - cr);
}

/**
 * Per-arm stats. Arms are in position order, control first. `window` carries the day counts
 * from `sliceDaily` when the counts came from daily data (defaults: all zero).
 */
export function computeStats(
  arms: readonly ArmCounts[],
  window: { start?: number; days?: number; n?: number } = {},
): ExperimentStats {
  const out: ArmStat[] = arms.map((a, i) => ({
    ...a,
    i,
    color: armColor(i),
    cr: a.v ? a.c / a.v : 0,
    lift: 0,
    prob: null,
    lo: null,
    hi: null,
    p: null,
  }));
  const c0 = out[0];
  if (c0) {
    out.forEach((a, i) => {
      if (!i) return;
      const se = Math.sqrt(
        rateVariance(c0.cr) / Math.max(c0.v, 1) + rateVariance(a.cr) / Math.max(a.v, 1),
      );
      const diff = a.cr - c0.cr;
      a.lift = c0.cr ? diff / c0.cr : 0;
      a.prob = se ? Math.min(0.994, Math.max(0.006, phi(diff / se))) : 0.5;
      a.lo = c0.cr ? (diff - 1.96 * se) / c0.cr : 0;
      a.hi = c0.cr ? (diff + 1.96 * se) / c0.cr : 0;
      a.p = se ? 2 * (1 - phi(Math.abs(diff / se))) : 1;
    });
  }
  const start = window.start ?? 0;
  const days = window.days ?? 0;
  return {
    arms: out,
    start,
    days,
    n: window.n ?? days - start,
    v: out.reduce((t, a) => t + a.v, 0),
    c: out.reduce((t, a) => t + a.c, 0),
  };
}

export type StatsRange = "7" | "14" | "30" | "all";

export interface DailySlice {
  /** Per-arm totals over the window, in arm order. */
  arms: { v: number; c: number }[];
  start: number;
  days: number;
  /** Days in the window. */
  n: number;
}

/**
 * Totals per arm over the last `range` days of `daily` (`daily[arm][day]`, oldest first, every
 * arm the same length). `all` sums everything.
 */
export function sliceDaily(
  daily: readonly (readonly { v: number; c: number }[])[],
  range: StatsRange,
): DailySlice {
  const days = daily[0]?.length ?? 0;
  const start = range === "all" ? 0 : Math.max(0, days - Number(range));
  const arms = daily.map((series) => {
    let v = 0;
    let c = 0;
    for (let d = start; d < days; d++) {
      v += series[d]?.v ?? 0;
      c += series[d]?.c ?? 0;
    }
    return { v, c };
  });
  return { arms, start, days, n: days - start };
}

/** `sliceDaily` then `computeStats`, attaching each arm's metadata (`name`, `weight`, …). */
export function statsFromDaily(
  meta: readonly Omit<ArmCounts, "v" | "c">[],
  daily: readonly (readonly { v: number; c: number }[])[],
  range: StatsRange,
): ExperimentStats {
  const s = sliceDaily(daily, range);
  return computeStats(
    meta.map((m, i) => ({ ...m, v: s.arms[i]?.v ?? 0, c: s.arms[i]?.c ?? 0 })),
    s,
  );
}
