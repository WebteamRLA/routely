/**
 * The experiment detail page's view model — header, Results tab, Review tab and the dialogs'
 * facts — built from plain, serializable facts the results service gathers from the database.
 *
 * Every number, chance and verdict comes from `lib/verdict.ts` and every day count and date
 * label from `lib/experiment-time.ts`; this module only arranges them into the strings and
 * colours the designed screen renders. It is pure (no database, no clock — `now` is an input) so
 * the service, the public share page and the unit tests all get the same output for the same
 * facts, and a client component can recompute the chart hover without a round trip.
 *
 * The design's prototype computed the same things from a mock (`buildExperimentModel` in the old
 * `lib/mock/experiment.ts`); the formulas and copy here follow it except where the spec changed
 * them (Bayesian chance, "update your site to <W>", no held-back state, the 1,000/100 gate).
 */

import { changeSummaries } from "@/lib/change-summary";
import { percentAxis } from "@/lib/chart-axis";
import {
  capitalize,
  dayNumber,
  formatClockTime,
  formatDateAtTime,
  formatDays,
  formatMonthDay,
  formatMonthDayYear,
  formatRunRange,
  isJustNow,
  ranDays,
  relativeTime,
} from "@/lib/experiment-time";
import { formatNumber } from "@/lib/format";
import { type DeviceTypeName, shortUrl, targetingSummary } from "@/lib/launch-rules";
import { trackingStatus } from "@/lib/pixel-status";
import {
  MIN_CONVERSIONS_PER_ARM,
  MIN_VISITORS_PER_ARM,
  NOT_PROOF_NOTE,
  type ResultStatus,
  type ResultsAnalysis,
  WIN_CHANCE,
  analyzeResults,
  armProgress,
  completedOutcomeSentence,
  conversionsStillNeeded,
  decisionBadge,
  decisionVerdict,
  experimentVerdict,
  formatChance,
  formatLift,
  formatRate1,
  formatRate2,
  manualChoiceCaveat,
  pauseResultLabel,
  recommendedArm,
  showCumulativeChart,
  type WinnerBasis,
  winnerBadge,
} from "@/lib/verdict";

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** A launched experiment's status. Drafts never reach the results screens — they open the wizard. */
export type DetailStatus = Exclude<ResultStatus, "draft">;

export interface ArmInput {
  /** The variant id; null for Control. */
  key: string | null;
  name: string;
  /** Palette slot: 0 for Control, the stored `colorIndex` (1–4) for a variant. */
  colorIndex: number;
  /** Configured share of the experiment's traffic, a whole number; the arms total 100. */
  pct: number;
  /** Split URL: the arm's page (Control's is `ResultsInput.controlUrl`). Null for A/B. */
  url: string | null;
  /** What this arm shows: "Original page, unchanged", change summaries, or its URL. */
  lines: string[];
  /** A/B variants: saved visual changes. 0 otherwise. */
  changeCount: number;
  /** count(assignments). */
  visitors: number;
  /** count(conversions). */
  conversions: number;
}

/** Cumulative per-arm totals for each UTC day of the run, arms in `ResultsInput.arms` order. */
export interface SeriesInput {
  days: string[];
  visitors: number[][];
  conversions: number[][];
}

export interface ResultsInput {
  id: string;
  name: string;
  type: "ab" | "split";
  status: DetailStatus;
  /** The tested page (A/B) or the Control URL (Split URL), as stored. */
  controlUrl: string;
  /** The goal URL, as stored. */
  goalUrl: string;
  /** `trafficAllocation`, 1–100. */
  include: number;
  /** ISO instants. `publishedAt` is the first launch. */
  publishedAt: string;
  pausedAt: string | null;
  endedAt: string | null;
  /** The latest RESUMED activity, for "Resumed just now". */
  resumedAt: string | null;
  /** The instant the facts were read — the model never reads a clock. */
  now: string;
  arms: ArmInput[];
  series: SeriesInput;
  /** The winner the team chose (`Experiment.winner*`); null until one is chosen. */
  decision: DecisionInput | null;
}

export interface DecisionInput {
  /** The chosen arm's `ArmInput.key`: null for Control. */
  armKey: string | null;
  basis: WinnerBasis;
  /** Who chose it; null for a deleted member, and always on the public share page. */
  chosenBy: string | null;
  /** ISO instant. */
  chosenAt: string;
}

export type ActivityType =
  | "CREATED"
  | "LAUNCHED"
  | "PAUSED"
  | "RESUMED"
  | "ENDED"
  | "EDITED"
  | "RESULT_READY"
  | "WINNER_CHOSEN";

export interface ActivityInput {
  id: string;
  type: ActivityType;
  /** The actor's display name; null for a system entry or a deleted user. */
  actorName: string | null;
  /** True when the row has no actor because the system wrote it (RESULT_READY). */
  system: boolean;
  at: string;
  /** EDITED: the fields that changed, when the writer recorded them. */
  fields: string[];
  /** WINNER_CHOSEN: the version and whether it was the recommendation. */
  winner?: { name: string; basis: WinnerBasis } | null;
}

export interface UrlCheckInput {
  url: string;
  role: "control" | "variant" | "goal";
  /** Null when the URL has never been checked. */
  result: "OK" | "MISSING" | "ERROR" | null;
  pageLoaded: boolean;
  detail: string | null;
  checkedAt: string | null;
}

export interface ReviewInput {
  /** The project's domain. */
  domain: string;
  devices: DeviceTypeName[];
  createdAt: string;
  createdByName: string | null;
  /** Website tracking signals (`lib/pixel-status.ts`). */
  lastSeenAt: string | null;
  pixelVerifiedAt: string | null;
  /** Latest stored tracking check per URL the experiment depends on. */
  urlChecks: UrlCheckInput[];
  /** Oldest first. */
  activity: ActivityInput[];
}

export interface ModelOptions {
  /** IANA zone for calendar labels ("Sep 22", "8:05 AM"). Day arithmetic stays UTC. */
  timeZone?: string;
}

// ---------------------------------------------------------------------------------------------
// Palette (the design's)
// ---------------------------------------------------------------------------------------------

const ACCENT = "#0070C9";
const ACCENT_TINT = "#E6F4FF";
const ACCENT_WASH = "#F0F7FF";
const ACCENT_INK = "#0060AD";
const ACCENT_LINE = "#B3DBFF";
const GREEN = "#16A34A";

/** Arm colours by palette slot — the same five the wizards use, so an arm keeps its colour. */
export const ARM_COLORS = ["#6B7280", ACCENT, "#F97316", "#14B8A6", "#A855F7"];

export function armColor(colorIndex: number): string {
  const n = ARM_COLORS.length;
  return ARM_COLORS[((Math.trunc(colorIndex) % n) + n) % n]!;
}

export type Tone = "ok" | "warn" | "fail" | "info";

export const HEALTH_TONES = {
  ok: { bg: "#ECFDF5", border: "#BBF7D0", iconBg: "#DCFCE7", fg: "#166534", ink: "#166534" },
  warn: { bg: "#FEF3C7", border: "#FDE68A", iconBg: "#FEF3C7", fg: "#92400E", ink: "#92400E" },
  fail: { bg: "#FEF2F2", border: "#FECACA", iconBg: "#FEE2E2", fg: "#B91C1C", ink: "#B91C1C" },
  info: {
    bg: ACCENT_WASH,
    border: ACCENT_LINE,
    iconBg: ACCENT_TINT,
    fg: ACCENT_INK,
    ink: "#111827",
  },
};

export const CHECK_TONES = {
  ok: { iconBg: "#DCFCE7", fg: "#166534", sr: "Passed" },
  warn: { iconBg: "#FEF3C7", fg: "#92400E", sr: "Needs attention" },
  fail: { iconBg: "#FEE2E2", fg: "#B91C1C", sr: "Issue" },
  info: { iconBg: ACCENT_TINT, fg: ACCENT_INK, sr: "Info" },
};

const VERDICT_TONES = {
  win: { bg: "#ECFDF5", border: "#BBF7D0", iconBg: "#DCFCE7", fg: "#166534", ink: "#166534" },
  flat: { bg: "#FFFFFF", border: "#E5E7EB", iconBg: "#F3F4F6", fg: "#4B5563", ink: "#111827" },
  wait: { bg: "#FFFFFF", border: "#E5E7EB", iconBg: "#FEF3C7", fg: "#92400E", ink: "#111827" },
  collect: {
    bg: "#FFFFFF",
    border: "#E5E7EB",
    iconBg: ACCENT_TINT,
    fg: ACCENT_INK,
    ink: "#111827",
  },
};

const BADGES: Record<DetailStatus, { label: string; bg: string; fg: string; dot: string }> = {
  running: { label: "Running", bg: "#E6F4FF", fg: "#0060AD", dot: "#0091FF" },
  paused: { label: "Paused", bg: "#FEF3C7", fg: "#92400E", dot: "#F59E0B" },
  completed: { label: "Completed", bg: "#DCFCE7", fg: "#166534", dot: "#16A34A" },
};

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** "/pricing" from "https://acme.com/pricing" — the Split URL header and list show paths. */
export function urlPath(url: string): string {
  const s = shortUrl(url);
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i) : "/";
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const TYPE_LABEL = { ab: "A/B Testing", split: "Split URL" } as const;

/** "Original page, unchanged" — Control's description line in an A/B test. */
export const ORIGINAL_PAGE = "Original page, unchanged";

/** Description lines for an A/B variant: one per saved change. */
export function abVariantLines(changes: unknown): string[] {
  return changeSummaries(changes);
}

/** The design said "Goal page views"; what is counted is visitors who converted, at most once each. */
const GOAL_COUNT_SUB = "Reached the goal";

// ---------------------------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------------------------

export interface ChartModel {
  ok: boolean;
  /** Why there is no chart: no visitors at all yet, or data from only one day (a line needs two). */
  waiting: "visitors" | "second-day" | null;
  days: number;
  legend: { name: string; color: string }[];
  yTicks: { label: string; bottom: string; line: string }[];
  lines: { key: string; color: string; d: string }[];
  xTicks: { key: string; label: string; left: string; tx: string }[];
  aria: string;
  /** Per arm, per day: the cumulative rate (0 before an arm's first visitor). */
  rates: number[][];
  /** Per day: "Oct 3". */
  dates: string[];
  names: string[];
  colors: string[];
  yMaxPct: number;
}

const X = (i: number, d: number) => (d > 1 ? (i / (d - 1)) * 1000 : 500);

function buildChart(
  series: SeriesInput,
  arms: { name: string; color: string; rate: string }[],
  hasData: boolean,
): ChartModel {
  const D = series.days.length;
  const ok = showCumulativeChart(hasData, D);
  const rates = arms.map((_, i) =>
    series.days.map((_, d) => {
      const v = series.visitors[i]?.[d] ?? 0;
      const c = series.conversions[i]?.[d] ?? 0;
      // Before an arm's first visitor the cumulative rate is undefined; the line sits at 0.
      return v > 0 ? c / v : 0;
    }),
  );

  let maxR = 0;
  for (const line of rates) for (const r of line) maxR = Math.max(maxR, r);
  const { maxPct: yMaxPct, ticks } = percentAxis(maxR);
  const Y = (r: number) => 200 - ((r * 100) / yMaxPct) * 200;

  const dates = series.days.map((key) => formatMonthDay(new Date(`${key}T00:00:00.000Z`), "UTC"));
  const yTicks: ChartModel["yTicks"] = [];
  for (const yt of ticks) {
    yTicks.push({
      label: `${yt}%`,
      bottom: `${((yt / yMaxPct) * 100).toFixed(2)}%`,
      line: yt === 0 ? "#D1D5DB" : "#F3F4F6",
    });
  }
  const xIdx =
    D <= 5
      ? Array.from({ length: D }, (_, i) => i)
      : [...new Set([0, Math.round((D - 1) / 3), Math.round((2 * (D - 1)) / 3), D - 1])];

  return {
    ok,
    waiting: ok ? null : hasData ? "second-day" : "visitors",
    days: D,
    legend: arms.map((a) => ({ name: a.name, color: a.color })),
    yTicks,
    lines: ok
      ? rates.map((line, i) => ({
          key: String(i),
          color: arms[i]!.color,
          d: line
            .map((r, j) => `${j ? "L" : "M"}${X(j, D).toFixed(1)} ${Y(r).toFixed(1)}`)
            .join(" "),
        }))
      : [],
    xTicks: ok
      ? xIdx.map((i) => ({
          key: String(i),
          label: dates[i]!,
          left: `${(X(i, D) / 10).toFixed(2)}%`,
          tx: i === 0 ? "translateX(0)" : i === D - 1 ? "translateX(-100%)" : "translateX(-50%)",
        }))
      : [],
    aria: `Line chart of cumulative conversion rate by version over ${formatDays(D)}. ${arms
      .map((a) => `${a.name} ends at ${a.rate}`)
      .join(", ")}.`,
    rates,
    dates,
    names: arms.map((a) => a.name),
    colors: arms.map((a) => a.color),
    yMaxPct,
  };
}

/** Everything that depends on the hovered day; the last day when nothing is hovered. */
export function chartHover(chart: ChartModel, hoverIdx: number | null) {
  const D = chart.days;
  const hasHover = chart.ok && hoverIdx !== null && hoverIdx >= 0 && hoverIdx < D;
  const h = hasHover ? hoverIdx : Math.max(0, D - 1);
  const x = X(h, D);
  return {
    hasHover,
    hx: `${(x / 10).toFixed(2)}%`,
    dots: chart.ok
      ? chart.rates.map((line, i) => ({
          key: String(i),
          color: chart.colors[i]!,
          left: `${(x / 10).toFixed(2)}%`,
          bottom: `${((((line[h] ?? 0) * 100) / chart.yMaxPct) * 100).toFixed(2)}%`,
        }))
      : [],
    tipTx: x > 600 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
    tipDate: `${chart.dates[h] ?? ""} · day ${h + 1}`,
    tipRows: chart.ok
      ? chart.rates.map((line, i) => ({
          key: String(i),
          name: chart.names[i]!,
          color: chart.colors[i]!,
          value: formatRate2(line[h] ?? 0),
        }))
      : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

interface Moments {
  now: Date;
  published: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  /** Days run so far: running → day N; paused → day N at the pause; completed → inclusive days. */
  days: number;
  justPaused: boolean;
  justResumed: boolean;
  justLaunched: boolean;
}

function moments(input: ResultsInput): Moments {
  const now = new Date(input.now);
  const published = new Date(input.publishedAt);
  const pausedAt = input.pausedAt ? new Date(input.pausedAt) : null;
  const endedAt = input.endedAt ? new Date(input.endedAt) : null;
  const days =
    input.status === "completed"
      ? ranDays(published, endedAt ?? now)
      : input.status === "paused"
        ? dayNumber(published, pausedAt ?? now)
        : dayNumber(published, now);
  return {
    now,
    published,
    pausedAt,
    endedAt,
    days,
    justPaused: input.status === "paused" && pausedAt !== null && isJustNow(pausedAt, now),
    justResumed:
      input.status === "running" &&
      input.resumedAt !== null &&
      isJustNow(new Date(input.resumedAt), now),
    justLaunched: input.status === "running" && isJustNow(published, now),
  };
}

function bothOrAll(n: number): string {
  return n === 2 ? "both versions" : "all versions";
}

export function buildResultsModel(input: ResultsInput, options: ModelOptions = {}) {
  const tz = options.timeZone ?? "UTC";
  const m = moments(input);
  const { status } = input;
  const isDone = status === "completed";

  const analysis = analyzeResults(
    input.arms.map((a) => ({ name: a.name, visitors: a.visitors, conversions: a.conversions })),
  );
  const { hasData, totalVisitors: totV, totalConversions: totC } = analysis;
  const colors = input.arms.map((a, i) => armColor(i === 0 ? 0 : a.colorIndex));
  const decision = isDone ? input.decision : null;
  const decidedIndex = decision
    ? Math.max(
        0,
        input.arms.findIndex((a) => a.key === decision.armKey),
      )
    : -1;
  const recommended = recommendedArm(analysis);

  // Header
  const where =
    input.type === "ab"
      ? shortUrl(input.controlUrl)
      : input.arms.length > 2
        ? `${urlPath(input.controlUrl)} → ${input.arms.length - 1} variants`
        : `${urlPath(input.controlUrl)} → ${urlPath(input.arms[1]?.url ?? "")}`;
  let timing: string;
  if (m.justPaused) timing = `Paused just now after ${formatDays(m.days)}`;
  else if (m.justResumed) timing = `Resumed just now · day ${m.days}`;
  else if (status === "paused") {
    timing = `Paused ${formatMonthDay(m.pausedAt ?? m.now, tz)} after ${formatDays(m.days)}`;
  } else if (isDone) {
    timing = `Ran ${formatRunRange(m.published, m.endedAt ?? m.now, tz)} (${formatDays(m.days)})`;
  } else if (m.justLaunched) timing = "Launched just now";
  else timing = `Running since ${formatMonthDay(m.published, tz)} · day ${m.days}`;

  const header = {
    name: input.name,
    sub: `${TYPE_LABEL[input.type]} · ${where} · ${timing}`,
    badge: BADGES[status],
    canPause: status === "running",
    canResume: status === "paused",
    canEnd: status === "running" || status === "paused",
  };

  // Verdict
  const v = decision
    ? decisionVerdict(analysis, {
        armIndex: decidedIndex,
        basis: decision.basis,
        chosenBy: decision.chosenBy,
        chosenLabel: formatMonthDay(new Date(decision.chosenAt), tz),
      })
    : experimentVerdict(analysis, {
        status,
        endedLabel: formatMonthDay(m.endedAt ?? m.now, tz),
        days: m.days,
      });
  const verdict = {
    ...v,
    ...VERDICT_TONES[v.kind],
    /** What to do with the chosen version — Routely does not serve it. */
    nextStep: decision ? nextStep(input, decidedIndex) : null,
    progress: analysis.arms.map((a, i) => {
      const p = armProgress(a);
      return {
        key: String(i),
        name: a.name,
        color: colors[i]!,
        vis: p.visitorsLabel,
        visW: `${(p.visitorsFraction * 100).toFixed(1)}%`,
        visFill: p.visitorsMet ? GREEN : ACCENT,
        conv: p.conversionsLabel,
        convW: `${(p.conversionsFraction * 100).toFixed(1)}%`,
        convFill: p.conversionsMet ? GREEN : ACCENT,
      };
    }),
  };

  const tiles = [
    {
      label: "Visitors",
      value: formatNumber(totV),
      sub: hasData ? `Over ${formatDays(m.days)}` : "None yet",
    },
    { label: "Conversions", value: formatNumber(totC), sub: GOAL_COUNT_SUB },
    {
      label: "Conversion rate",
      value: hasData ? formatRate2(totC / totV) : "—",
      sub: "All versions combined",
    },
    { label: "Traffic share", value: `${input.include}%`, sub: "Of site visitors included" },
  ];

  const dist = input.arms.map((a, i) => {
    const share = hasData ? a.visitors / totV : a.pct / 100;
    return {
      key: String(i),
      name: a.name,
      color: colors[i]!,
      w: `${(share * 100).toFixed(2)}%`,
      label: `${(share * 100).toFixed(1)}%${hasData ? ` · ${formatNumber(a.visitors)} visitors` : ""}`,
    };
  });

  const rows = analysis.arms.map((a, i) => ({
    key: String(i),
    name: a.name,
    color: colors[i]!,
    desc: input.arms[i]!.lines.join(" · "),
    isBest: decision ? a.index === decidedIndex : recommended?.index === a.index,
    bestLabel: decision ? decisionBadge(decision.basis) : winnerBadge(status),
    vis: formatNumber(a.visitors),
    share: hasData ? formatRate1(a.visitors / totV) : `${input.arms[i]!.pct}%`,
    conv: formatNumber(a.conversions),
    rate: hasData ? formatRate2(a.rate) : "—",
    lift: i === 0 ? "Baseline" : formatLift(a.lift),
    liftFg:
      i === 0 || a.lift === null
        ? "#6B7280"
        : a.lift > 0
          ? "#166534"
          : a.lift < 0
            ? "#B91C1C"
            : "#4B5563",
    chance: i === 0 ? "—" : formatChance(a.chance),
    chanceFg:
      i === 0 || a.chance === null ? "#6B7280" : a.chance >= WIN_CHANCE ? "#166534" : "#111827",
  }));

  const chart = buildChart(
    input.series,
    rows.map((r) => ({ name: r.name, color: r.color, rate: r.rate })),
    hasData,
  );

  const runningFor = status === "paused" ? m.days : dayNumber(m.published, m.now);
  const pauseFacts = [
    { label: "Visitors so far", value: formatNumber(totV) },
    { label: "Running for", value: formatDays(runningFor) },
    { label: "Result", value: pauseResultLabel(analysis) },
  ];
  const resumeFacts = [
    { label: "Traffic split", value: input.arms.map((a) => `${a.pct}%`).join(" / ") },
    { label: "Visitors included", value: `${input.include}%` },
    { label: "Visitors so far", value: formatNumber(totV) },
  ];
  const endFacts = [
    { label: "Visitors so far", value: formatNumber(totV) },
    { label: "Ran for", value: formatDays(runningFor) },
    { label: "Result", value: pauseResultLabel(analysis) },
  ];

  return {
    id: input.id,
    name: input.name,
    status,
    /** `trafficAllocation`, 1–100 — the paused-edit dialog starts from it. */
    include: input.include,
    header,
    verdict,
    tiles,
    dist,
    distCaption: hasData
      ? "Share of experiment visitors by version"
      : "Configured split · no visitors yet",
    distAria: `Traffic distribution: ${dist.map((d) => `${d.name} ${d.label}`).join(", ")}`,
    rows,
    /** Rendered under the results whenever a chance is on screen (decision D1). */
    notProof: hasData ? NOT_PROOF_NOTE : null,
    goalLabel: `Page view · ${shortUrl(input.goalUrl)}`,
    chart,
    pauseFacts,
    resumeFacts,
    resumeBody: `Visitors will start seeing ${bothOrAll(input.arms.length)} again with the same split. Results continue from where they stopped.`,
    endFacts,
    winnerChoice: {
      /** Ending a live experiment with the choice, or (re)recording one on an ended experiment. */
      ending: !isDone,
      recommendedKey: recommended ? armKeyOf(input.arms[recommended.index]!) : null,
      currentKey: decision ? armKeyOf(input.arms[decidedIndex]!) : null,
      options: analysis.arms.map((a, i) => ({
        key: armKeyOf(input.arms[i]!),
        name: a.name,
        color: colors[i]!,
        rate: hasData ? formatRate2(a.rate) : "—",
        chance: i === 0 ? null : hasData ? formatChance(a.chance) : null,
        recommended: recommended?.index === i,
        /** Why the data does not back this choice; null for the recommendation. */
        caveat: manualChoiceCaveat(analysis, i),
      })),
    },
  };
}

/** The value `chooseWinnerAction` takes for an arm. */
function armKeyOf(arm: ArmInput): string {
  return arm.key ?? "control";
}

/** After a winner is chosen: what the customer has to change on their own site. */
function nextStep(input: ResultsInput, armIndex: number): string {
  const after = "Routely shows everyone the original page now that the experiment has ended.";
  if (armIndex <= 0) return "Keep your page as it is — everyone already sees the original again.";
  const arm = input.arms[armIndex]!;
  if (input.type === "split") {
    return `Update your site so visitors to ${shortUrl(input.controlUrl)} get ${shortUrl(arm.url ?? "")}: replace the page or redirect it. ${after}`;
  }
  return `Make ${arm.name}’s changes on ${shortUrl(input.controlUrl)}: ${arm.lines.join("; ")}. ${after}`;
}

export type ResultsModel = ReturnType<typeof buildResultsModel>;

// ---------------------------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------------------------

export interface CheckModel {
  key: string;
  tone: Tone;
  title: string;
  text: string;
  /** Offer "Check again" (re-runs the tracking checks; Editor and up). */
  recheck?: boolean;
}

const GATE = `${formatNumber(MIN_VISITORS_PER_ARM)} visitors and ${MIN_CONVERSIONS_PER_ARM} conversions`;

function trackingCheck(review: ReviewInput, now: Date, tz: string) {
  const lastSeenAt = review.lastSeenAt ? new Date(review.lastSeenAt) : null;
  const status = trackingStatus(
    {
      lastSeenAt,
      pixelVerifiedAt: review.pixelVerifiedAt ? new Date(review.pixelVerifiedAt) : null,
    },
    now,
    tz,
  );
  const domain = review.domain;
  if (status.state === "active" && status.seenAt) {
    const when = relativeTime(status.seenAt, now, "long");
    const fromHit = lastSeenAt !== null && lastSeenAt.getTime() === status.seenAt.getTime();
    return {
      active: true,
      check: {
        key: "tracking",
        tone: "ok" as Tone,
        title: "Tracking is active",
        text: fromHit
          ? `Routely received an event from ${domain} ${when}.`
          : `The Routely code was found on ${domain} ${when}.`,
      },
    };
  }
  if (status.state === "not_seen") {
    return {
      active: false,
      check: {
        key: "tracking",
        tone: "warn" as Tone,
        title: "No recent events",
        text: `Routely hasn’t received an event from ${domain} since ${status.since}. Check that the Routely code is still on your pages.`,
      },
    };
  }
  return {
    active: false,
    check: {
      key: "tracking",
      tone: "fail" as Tone,
      title: "Tracking isn’t set up",
      text: `Routely hasn’t received any events from ${domain}. Install the Routely code on your pages to collect results.`,
    },
  };
}

function urlChecks(input: ResultsInput, review: ReviewInput): CheckModel[] {
  const out: CheckModel[] = [];
  const pages = review.urlChecks.filter((c) => c.role !== "goal");

  if (input.type === "split" && pages.length > 0) {
    const unchecked = pages.filter((c) => c.result === null);
    const failing = pages.filter((c) => c.result !== null && !c.pageLoaded && c.result !== "OK");
    // "acme.com/pricing and /pricing-b": later URLs on the first one's host shrink to a path.
    const host = shortUrl(pages[0]!.url).split("/")[0];
    const label = (url: string, i: number) =>
      i > 0 && shortUrl(url).split("/")[0] === host ? urlPath(url) : shortUrl(url);
    if (failing.length > 0) {
      const detail = failing[0]!.detail;
      out.push({
        key: "reachable",
        tone: "fail",
        title: failing.length === 1 ? "A page isn’t reachable" : "Some pages aren’t reachable",
        text: `${joinAnd(failing.map((c) => shortUrl(c.url)))} didn’t load on the last check${detail ? `: ${detail}` : "."}`,
        recheck: true,
      });
    } else if (unchecked.length > 0) {
      out.push({
        key: "reachable",
        tone: "info",
        title: "Pages haven’t been checked yet",
        text: `${joinAnd(unchecked.map((c) => shortUrl(c.url)))} ${unchecked.length === 1 ? "hasn’t" : "haven’t"} been checked. Check again to confirm ${unchecked.length === 1 ? "it loads" : "they load"}.`,
        recheck: true,
      });
    } else {
      out.push({
        key: "reachable",
        tone: "ok",
        title: pages.length === 2 ? "Both pages are reachable" : "All pages are reachable",
        text: `${joinAnd(pages.map((c, i) => label(c.url, i)))} loaded normally on the last check.`,
      });
    }
  }

  // Pages that loaded without the code (or, for the goal, did not load at all) on the last check.
  const missing = review.urlChecks.filter(
    (c) =>
      c.result === "MISSING" ||
      (c.result === "ERROR" && (input.type === "ab" || c.role === "goal")),
  );
  if (missing.length > 0) {
    out.push({
      key: "code",
      tone: "fail",
      title:
        missing.length === 1
          ? "Routely code not found on a page"
          : `Routely code not found on ${missing.length} pages`,
      text: missing
        .map((c) => `${shortUrl(c.url)}: ${c.detail ?? "the Routely code wasn’t found."}`)
        .join(" "),
      recheck: true,
    });
  }
  return out;
}

function activityLabel(entry: ActivityInput): string {
  const who = entry.actorName ?? "a former member";
  switch (entry.type) {
    case "CREATED":
      return `Created by ${who}`;
    case "LAUNCHED":
      return `Launched by ${who}`;
    case "PAUSED":
      return `Paused by ${who}`;
    case "RESUMED":
      return `Resumed by ${who}`;
    case "ENDED":
      return `Ended by ${who}`;
    case "EDITED": {
      const names = entry.fields.map((f) => EDITED_FIELDS[f] ?? f);
      return names.length > 0
        ? `${capitalize(joinAnd(names))} changed by ${who}`
        : `Edited by ${who}`;
    }
    case "RESULT_READY":
      return `Every version passed ${GATE}`;
    case "WINNER_CHOSEN": {
      const name = entry.winner?.name ?? "A version";
      return entry.winner?.basis === "manual"
        ? `${name} chosen by ${who} (a judgement call, not a reliable result)`
        : `${name} chosen as the winner by ${who}`;
    }
  }
}

const EDITED_FIELDS: Record<string, string> = {
  name: "name",
  trafficAllocation: "traffic share",
};

export function buildReviewModel(
  input: ResultsInput,
  review: ReviewInput,
  results: ResultsModel,
  options: ModelOptions = {},
) {
  const tz = options.timeZone ?? "UTC";
  const m = moments(input);
  const { status } = input;
  const isDone = status === "completed";
  const analysis: ResultsAnalysis = analyzeResults(
    input.arms.map((a) => ({ name: a.name, visitors: a.visitors, conversions: a.conversions })),
  );
  const { hasData, enough, winner, totalVisitors: totV, totalConversions: totC } = analysis;
  const versions = bothOrAll(input.arms.length);

  // --- Checks ---------------------------------------------------------------------------------
  const checks: CheckModel[] = [];
  const live = status !== "completed";
  const tracking = trackingCheck(review, m.now, tz);
  // The design shows tracking while it is the open question (no visitors yet); once visitors
  // arrive it is shown only when it has gone wrong.
  if (live && (!hasData || !tracking.active)) checks.push(tracking.check);

  if (hasData) {
    checks.push({
      key: "recording",
      tone: "ok",
      title: "Visitors are being recorded",
      text: `${formatNumber(totV)} visitors and ${formatNumber(totC)} conversions ${isDone ? `in ${formatDays(m.days)}.` : "so far."}`,
    });
  } else if (m.justLaunched) {
    checks.push({
      key: "recording",
      tone: "info",
      title: "No visitors yet",
      text: "Launched just now. Visitors are assigned to a version as soon as they reach the tested page.",
    });
  } else if (status === "running" && m.now.getTime() - m.published.getTime() >= 86_400_000) {
    checks.push({
      key: "recording",
      tone: "warn",
      title: "No visitors since launch",
      text: `Nobody has been assigned since launch on ${formatMonthDay(m.published, tz)}. Check that ${shortUrl(input.controlUrl)} gets traffic and has the Routely code.`,
    });
  } else if (status === "running") {
    checks.push({
      key: "recording",
      tone: "info",
      title: "No visitors in the experiment yet",
      text: "It can take a little while after launch for the first visitors to be assigned.",
    });
  } else {
    checks.push({
      key: "recording",
      tone: "info",
      title: "No visitors yet",
      text: "Nobody reached the tested page while the experiment was running.",
    });
  }

  if (input.type === "ab") {
    input.arms.slice(1).forEach((a, i) => {
      const n = a.changeCount;
      checks.push(
        n > 0
          ? {
              key: `changes-${i}`,
              tone: "ok",
              title: `${a.name} has ${n} ${n === 1 ? "saved change" : "saved changes"}`,
              text: a.lines.join(" · "),
            }
          : {
              key: `changes-${i}`,
              tone: "warn",
              title: `${a.name} has no saved changes`,
              text: "Visitors in this version see the original page.",
            },
      );
    });
  }
  checks.push(...urlChecks(input, review));

  checks.push({
    key: "split",
    tone: "ok",
    title: "Traffic split adds up to 100%",
    text: `${input.arms.map((a) => `${a.name} ${a.pct}%`).join(" · ")}, with ${input.include === 100 ? "all visitors" : `${input.include}% of visitors`} included.`,
  });
  checks.push({
    key: "goal",
    tone: "ok",
    title: "Goal page is set",
    text: `Page view of ${shortUrl(input.goalUrl)}.`,
  });

  if (hasData) {
    if (enough) {
      checks.push({
        key: "data",
        tone: "ok",
        title: "Enough data for a result",
        text: `Every version has passed ${GATE}.`,
      });
    } else if (isDone) {
      checks.push({
        key: "data",
        tone: "warn",
        title: "Ended before a result",
        text: `Not every version reached ${GATE} before it ended.`,
      });
    } else if (status === "paused") {
      checks.push({
        key: "data",
        tone: "warn",
        title: "Not enough data for a result",
        text: `${joinAnd(input.arms.map((a) => formatNumber(a.conversions)))} conversions so far. Each version needs at least ${GATE}.`,
      });
    } else {
      checks.push({
        key: "data",
        tone: "info",
        title: "Collecting more data",
        text: `Each version needs at least ${GATE} before Routely suggests a winner.`,
      });
    }
  }

  if (status === "paused") {
    checks.push({
      key: "resume",
      tone: "info",
      title: "Ready to resume",
      text: `Visitors start seeing ${versions} again as soon as you resume.`,
    });
  } else if (m.justResumed) {
    checks.push({
      key: "resume",
      tone: "ok",
      title: "Running",
      text: `Visitors are seeing ${versions} again.`,
    });
  }

  const nIssues = checks.filter((c) => c.tone === "fail" || c.tone === "warn").length;
  const nFail = checks.filter((c) => c.tone === "fail").length;
  const nPass = checks.filter((c) => c.tone === "ok").length;

  // --- Health ---------------------------------------------------------------------------------
  const pausedLabel = formatMonthDay(m.pausedAt ?? m.now, tz);
  let health: { tone: Tone; title: string; text: string };
  if (m.justPaused) {
    health = {
      tone: "warn",
      title: "Paused just now",
      text: "Visitors see the original page while it’s paused. Results collected so far are kept, and you can resume at any time.",
    };
  } else if (m.justResumed) {
    health = {
      tone: "ok",
      title: "Running again",
      text: `Resumed just now. Results continue from ${formatNumber(totV)} visitors.`,
    };
  } else if (isDone) {
    health = {
      tone: "info",
      title: `Completed on ${formatMonthDay(m.endedAt ?? m.now, tz)}`,
      text: `This experiment has ended and visitors see the original page again. ${
        input.decision
          ? `${input.arms.find((a) => a.key === input.decision!.armKey)?.name ?? "Control"} was chosen to keep.`
          : completedOutcomeSentence(analysis)
      }`,
    };
  } else if (status === "paused") {
    if (!enough) {
      const k = conversionsStillNeeded(analysis.arms);
      const vNeeded = analysis.arms.reduce(
        (max, a) => Math.max(max, MIN_VISITORS_PER_ARM - a.visitors),
        0,
      );
      const need =
        k > 0
          ? `about ${formatNumber(k)} more ${k === 1 ? "conversion" : "conversions"}`
          : `about ${formatNumber(vNeeded)} more ${vNeeded === 1 ? "visitor" : "visitors"}`;
      health = {
        tone: "warn",
        title: "Paused before a result",
        text: `Paused on ${pausedLabel} after ${formatDays(m.days)}. Nothing blocks resuming, but each version still needs ${need} before Routely can suggest a winner.`,
      };
    } else {
      health = {
        tone: "info",
        title: "Paused",
        text: `Paused on ${pausedLabel} after ${formatDays(m.days)}. Every version already has enough data for a result, and nothing blocks resuming.`,
      };
    }
  } else if (nIssues > 0) {
    health = {
      tone: nFail > 0 ? "fail" : "warn",
      title: "Needs attention",
      text: `${nIssues === 1 ? "One check below needs" : `${nIssues} checks below need`} attention. Results keep updating as visitors arrive.`,
    };
  } else if (!hasData) {
    const launched = `${formatMonthDay(m.published, tz)} at ${formatClockTime(m.published, tz)}`;
    health = {
      tone: "info",
      title: "Live — waiting for the first visitors",
      text: m.justLaunched
        ? "Launched just now. Results appear as soon as visitors reach the tested page."
        : tracking.active
          ? `Launched ${launched}. Tracking is active on ${review.domain}, so visitors should appear as soon as they reach the tested page.`
          : `Launched ${launched}. Results appear as soon as visitors reach the tested page.`,
    };
  } else {
    health = {
      tone: "ok",
      title: "Running normally",
      text: `No issues found. Results update as visitors arrive.${winner ? ` ${winner.name} is already the likely winner.` : ""}`,
    };
  }

  // --- Configuration --------------------------------------------------------------------------
  const created = new Date(review.createdAt);
  const rows: { label: string; value: string }[] = [
    { label: "Experiment type", value: TYPE_LABEL[input.type] },
  ];
  if (input.type === "ab") rows.push({ label: "Tested page", value: shortUrl(input.controlUrl) });
  rows.push({
    label: "Visitors included",
    value: input.include === 100 ? "All visitors (100%)" : `${input.include}% of site visitors`,
  });
  rows.push({ label: "Targeting", value: targetingSummary(review.devices, "sentence") });
  rows.push({ label: "Goal", value: `Page view · ${shortUrl(input.goalUrl)}` });
  rows.push({
    label: "Created",
    value: `${formatMonthDayYear(created, tz)}${review.createdByName ? ` by ${review.createdByName}` : ""}`,
  });
  const config = {
    caption:
      status === "running"
        ? "Pause the experiment to change its setup."
        : isDone
          ? "This experiment has ended. Its setup can’t be changed."
          : "You can change the setup while it’s paused.",
    rows,
    versions: input.arms.map((a, i) => ({
      key: String(i),
      name: a.name,
      color: results.rows[i]!.color,
      pct: `${a.pct}%`,
      lines: a.lines,
    })),
  };

  const glance = [
    { label: "Visitors", value: formatNumber(totV), sub: hasData ? "All versions" : "None yet" },
    { label: "Conversions", value: formatNumber(totC), sub: GOAL_COUNT_SUB },
    {
      label: isDone ? "Ran for" : "Days running",
      value: String(m.days),
      sub: m.days === 1 ? "day" : "days",
    },
    { label: "Traffic share", value: `${input.include}%`, sub: "Of visitors" },
  ];

  // --- Activity -------------------------------------------------------------------------------
  const when = (entry: { type: ActivityType; at: string }) => {
    const at = new Date(entry.at);
    if (isJustNow(at, m.now)) return capitalize(relativeTime(at, m.now));
    return entry.type === "CREATED" || entry.type === "RESULT_READY"
      ? formatMonthDayYear(at, tz)
      : formatDateAtTime(at, tz);
  };
  const events =
    review.activity.length > 0
      ? review.activity.map((entry) => ({
          key: entry.id,
          label: activityLabel(entry),
          when: when(entry),
        }))
      : // Experiments created before the activity log existed: what the timestamps alone can say.
        [
          { key: "created", type: "CREATED" as const, at: review.createdAt, label: "Created" },
          { key: "launched", type: "LAUNCHED" as const, at: input.publishedAt, label: "Launched" },
          ...(status === "paused" && input.pausedAt
            ? [{ key: "paused", type: "PAUSED" as const, at: input.pausedAt, label: "Paused" }]
            : []),
          ...(isDone && input.endedAt
            ? [{ key: "ended", type: "ENDED" as const, at: input.endedAt, label: "Ended" }]
            : []),
        ].map((e) => ({ key: e.key, label: e.label, when: when(e) }));

  return {
    health: {
      ...health,
      ...HEALTH_TONES[health.tone],
      summary: nIssues
        ? `${nIssues}${nIssues === 1 ? " issue" : " issues"} · ${nPass} passed`
        : `${nPass} of ${checks.length} passed`,
    },
    checks,
    config,
    glance,
    events,
  };
}

export type ReviewModel = ReturnType<typeof buildReviewModel>;

/** The whole detail page. `review` is null on the public share page. */
export function buildExperimentModel(
  input: ResultsInput,
  review: ReviewInput | null,
  options: ModelOptions = {},
) {
  const results = buildResultsModel(input, options);
  return {
    ...results,
    review: review ? buildReviewModel(input, review, results, options) : null,
  };
}

export type ExperimentModel = ReturnType<typeof buildExperimentModel>;

/** `?view=` on `/experiments/[id]`: a tab, or one of the dialogs opened over it. */
export const EXPERIMENT_MODES = ["results", "review", "resume", "pause", "end", "share"] as const;
export type ExperimentMode = (typeof EXPERIMENT_MODES)[number];
