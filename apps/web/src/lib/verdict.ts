/**
 * The plain-language verdict on an experiment's results, and the status presentation table.
 * Titles, bodies and maths are verbatim from the design prototype's `verdict()`.
 */

import type { DisplayStatusKey, ExperimentKind, ExperimentStatusKey, Threshold } from "./domain";
import { fN, fP, fS } from "./format";
import { rateVariance, type ArmStat, type ExperimentStats } from "./stats";

export interface StatusStyle {
  label: string;
  glyph: string;
  /** Glyph colour. */
  gc: string;
  bg: string;
  color: string;
  border: string;
  dot: string;
}

export const STATUS: Record<DisplayStatusKey, StatusStyle> = {
  running: {
    label: "Running",
    glyph: "●",
    gc: "#13A06B",
    bg: "#EAF7F1",
    color: "#0B6B47",
    border: "#C3E7D6",
    dot: "#13A06B",
  },
  paused: {
    label: "Paused",
    glyph: "‖",
    gc: "#B7790B",
    bg: "#FDF5E6",
    color: "#8A5A06",
    border: "#F1DDB6",
    dot: "#D9930F",
  },
  draft: {
    label: "Draft",
    glyph: "○",
    gc: "#7C879C",
    bg: "#FFFFFF",
    color: "#4B5568",
    border: "#D5DAE4",
    dot: "#9AA3B5",
  },
  completed: {
    label: "Completed",
    glyph: "■",
    gc: "#7C879C",
    bg: "#F1F3F6",
    color: "#2E3A52",
    border: "#DDE1E8",
    dot: "#7C879C",
  },
  winner: {
    label: "Winner",
    glyph: "★",
    gc: "#F0603F",
    bg: "#0A1633",
    color: "#FFFFFF",
    border: "#0A1633",
    dot: "#F0603F",
  },
};

export type Tone = "good" | "bad" | "neutral" | "wait";
export const TONE: Record<Tone, string> = {
  good: "#0F7A52",
  bad: "#B4361F",
  neutral: "#4B5568",
  wait: "#4B5568",
};

export const TYPE_LABEL: Record<ExperimentKind, string> = { redirect: "Split URL", ab: "A/B test" };

/** `winner` = completed with a variant (position > 0) declared the winner. */
export function displayStatus(
  status: ExperimentStatusKey,
  winnerPosition: number | null | undefined,
): DisplayStatusKey {
  return status === "completed" && winnerPosition != null && winnerPosition > 0 ? "winner" : status;
}

export type VerdictKind = "draft" | "wait" | "win" | "control" | "flat" | "early";

export interface Verdict {
  kind: VerdictKind;
  title: string;
  body: string;
  short: string;
  tone: Tone;
  leader?: ArmStat;
  /** Running and past the threshold either way: the test can be called. */
  ready?: boolean;
  /** "Too early" only: "~N days" / "~1 day" / "60+ days". */
  daysLeft?: string;
  /** "Too early" only: more visitors needed per arm. */
  moreVisitors?: number;
}

/**
 * The verdict for an experiment.
 *
 * - `status` draft → "Not launched"; no visitors (or no variants) → "Waiting for visitors".
 * - completed → decided by `winnerPosition`: 0 control won, n variant n won, null no clear winner.
 * - otherwise (running/paused) → winning once the best variant's chance to beat control reaches
 *   `threshold`; control winning once every variant's is ≤ 1 − threshold; else too early, with
 *   a sample-size estimate: need = ⌈7.84·(p0(1−p0) + p1(1−p1)) / Δ²⌉ per arm (80% power at
 *   α = .05), Δ the observed difference or 5% of p0 (at least 0.001) when there is none.
 */
export function verdict(
  status: ExperimentStatusKey,
  winnerPosition: number | null | undefined,
  st: ExperimentStats,
  thr: Threshold | number,
): Verdict {
  const vs = st.arms.slice(1);
  if (status === "draft") {
    return {
      kind: "draft",
      title: "Not launched",
      body: "Finish setup and launch to start collecting data.",
      short: "—",
      tone: "neutral",
    };
  }
  if (!st.v || !vs.length) {
    return {
      kind: "wait",
      title: "Waiting for visitors",
      body: "Results appear after the first visitors are assigned. This usually takes under an hour.",
      short: "Collecting data",
      tone: "wait",
    };
  }
  const control = st.arms[0]!;
  const best = vs.reduce((b, a) => (a.cr > b.cr ? a : b), vs[0]!);
  const prob = (a: ArmStat) => a.prob ?? 0.5;
  const conf = Math.round(prob(best) * 100);

  if (status === "completed") {
    if (winnerPosition === 0) {
      return {
        kind: "control",
        title: "Control won",
        body:
          "No variant beat the original. " + best.name + " came closest at " + fS(best.lift) + ".",
        short: "Control won",
        tone: "bad",
        leader: control,
      };
    }
    const w = winnerPosition == null ? undefined : st.arms[winnerPosition];
    if (!w) {
      return {
        kind: "flat",
        title: "No clear winner",
        body:
          "The difference was too small to call. " +
          best.name +
          " ended at " +
          fS(best.lift) +
          " with " +
          conf +
          "% confidence.",
        short: "Inconclusive",
        tone: "neutral",
        leader: best,
      };
    }
    return {
      kind: "win",
      title: w.name + " won",
      body:
        w.name +
        " converted " +
        fS(w.lift) +
        " better than Control with " +
        Math.round(prob(w) * 100) +
        "% confidence.",
      short: w.name + " won",
      tone: "good",
      leader: w,
    };
  }

  if (prob(best) >= thr) {
    return {
      kind: "win",
      title: best.name + " is winning",
      body:
        "We're " +
        conf +
        "% confident " +
        best.name +
        " beats Control. It converts at " +
        fP(best.cr, 2) +
        " vs " +
        fP(control.cr, 2) +
        " (" +
        fS(best.lift) +
        ").",
      short: best.name + " winning",
      tone: "good",
      leader: best,
      ready: true,
    };
  }
  if (vs.every((a) => prob(a) <= 1 - thr)) {
    return {
      kind: "control",
      title: "Control is winning",
      body:
        "Every variant converts worse than the original. " +
        best.name +
        " is closest at " +
        fS(best.lift) +
        ".",
      short: "Control leading",
      tone: "bad",
      leader: control,
      ready: true,
    };
  }

  const p0 = control.cr;
  const p1 = best.cr;
  const diff = Math.abs(p1 - p0) || Math.max(p0 * 0.05, 0.001);
  const need = Math.ceil((7.84 * (rateVariance(p0) + rateVariance(p1))) / (diff * diff));
  const have = Math.min(...st.arms.map((a) => a.v));
  const more = Math.max(0, need - have);
  const perArmDay = st.v / Math.max(1, st.n) / st.arms.length;
  const daysLeft = Math.ceil(more / Math.max(1, perArmDay));
  const dl =
    daysLeft > 60 ? "60+ days" : "~" + Math.max(1, daysLeft) + " day" + (daysLeft > 1 ? "s" : "");
  return {
    kind: "early",
    title: "Too early to call",
    body:
      (best.lift >= 0
        ? best.name + " leads at " + fS(best.lift) + ", but"
        : "No variant is ahead yet, and") +
      " we're only " +
      conf +
      "% confident. About " +
      fN(more) +
      " more visitors per variant (" +
      dl +
      ") to reach " +
      Math.round(thr * 100) +
      "%.",
    short: best.lift >= 0 ? best.name + " leading" : "No leader yet",
    tone: "neutral",
    leader: best,
    daysLeft: dl,
    moreVisitors: more,
  };
}

/**
 * The winner the End-experiment modal preselects (prototype L3025): the leader's position
 * for a `win` verdict, 0 for `control`, otherwise −1 (no winner).
 */
export function defaultWinner(v: Verdict): number {
  if (v.kind === "win" && v.leader) return v.leader.i;
  if (v.kind === "control") return 0;
  return -1;
}
