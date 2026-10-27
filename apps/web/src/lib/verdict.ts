/**
 * Experiment results: rates, lifts, "chance to beat Control" and the verdict copy every screen
 * renders — the experiments list, the project dashboard, the experiment detail page, both wizard
 * result phases, the share page and notifications.
 *
 * One module on purpose (decision D1). The design makes statistical claims — "Chance to beat
 * Control", "Likely better", "Winner" — which CLAUDE.md §7 used to forbid. The user approved them
 * on three conditions, all of which live here so no screen can drift from them:
 *
 * 1. **A gate.** No winner, loser or lift-vs-control note until *every* arm has at least
 *    `MIN_VISITORS_PER_ARM` assigned visitors and `MIN_CONVERSIONS_PER_ARM` conversions.
 * 2. **A Bayesian quantity.** "Chance to beat Control" is P(p_variant > p_control) under
 *    independent Beta(1 + conversions, 1 + visitors − conversions) posteriors — a uniform prior
 *    per arm. That *is* a chance, which the design's two-proportion z-score Φ(z) is not.
 * 3. **"Not proof".** `NOT_PROOF_NOTE` is the short caveat to render beside any of it, and the
 *    design's "roll out <W>" is replaced by "update your site to <W>" — Routely cannot roll a
 *    winner out; the customer has to.
 *
 * Pure: no database, no server imports, no randomness. Everything is deterministic so server and
 * client render the same digits.
 */

import { formatNumber } from "@/lib/format";
import { isUtcDayKey, utcDayKey, type UtcDayKey } from "@/lib/utc-day";

// ---------------------------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------------------------

/** Assigned visitors every arm needs before Routely names a result. */
export const MIN_VISITORS_PER_ARM = 1000;
/** Conversions every arm needs before Routely names a result. */
export const MIN_CONVERSIONS_PER_ARM = 100;
/** Chance to beat Control at or above which a variant is "Likely better" / the winner. */
export const WIN_CHANCE = 0.95;
/** Chance to beat Control at or below which a variant is "Likely worse". */
export const LOSE_CHANCE = 0.05;
/** The cumulative chart needs at least this many days to draw a line. */
export const MIN_CHART_DAYS = 2;

/** The caveat to render wherever a chance, a "likely" or a winner appears. */
export const NOT_PROOF_NOTE =
  "Chance to beat Control is an estimate from the data so far, not proof. Deciding as soon as the numbers look good makes a false winner more likely.";

/** U+2212, used for every negative figure the design renders. */
export const MINUS = "−";

// ---------------------------------------------------------------------------------------------
// Inputs and per-arm figures
// ---------------------------------------------------------------------------------------------

/** UI status names, as every designed screen spells them. */
export type ResultStatus = "draft" | "running" | "paused" | "completed";

/** Maps the Prisma enum onto the designed status names. */
export function resultStatusOf(status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED"): ResultStatus {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "ACTIVE":
      return "running";
    case "PAUSED":
      return "paused";
    case "COMPLETED":
      return "completed";
  }
}

/** One arm's counts. Control first, then variants in position order. */
export interface ArmCounts {
  /** "Control" for the first arm; the stored variant name for the rest. */
  name: string;
  /** count(assignments) for this arm. */
  visitors: number;
  /** count(conversions) for this arm — at most one per assignment. */
  conversions: number;
}

/** Conversions ÷ assigned visitors, as a fraction; 0 when nobody was assigned. */
export function conversionRate(visitors: number, conversions: number): number {
  return visitors > 0 ? conversions / visitors : 0;
}

/**
 * Relative lift of `rate` over `baseRate`, as a fraction (`0.123` renders "+12.3%").
 * Null when the control rate is 0, where a ratio means nothing.
 */
export function relativeLift(rate: number, baseRate: number): number | null {
  return baseRate > 0 ? rate / baseRate - 1 : null;
}

/**
 * Absolute difference in percentage points: `(rate − baseRate) × 100`.
 * The list and project dashboard show this ("+0.6 pts vs control"); the detail page and the
 * wizards show `relativeLift` instead. Two definitions, two names.
 */
export function deltaPts(rate: number, baseRate: number): number {
  return (rate - baseRate) * 100;
}

/** Σconversions ÷ Σvisitors over every arm; null when nobody was assigned (rendered "—"). */
export function pooledRate(
  arms: readonly Pick<ArmCounts, "visitors" | "conversions">[],
): number | null {
  let visitors = 0;
  let conversions = 0;
  for (const arm of arms) {
    visitors += arm.visitors;
    conversions += arm.conversions;
  }
  return visitors > 0 ? conversions / visitors : null;
}

// ---------------------------------------------------------------------------------------------
// Chance to beat Control — P(p_v > p_c) under Beta posteriors
// ---------------------------------------------------------------------------------------------

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 — Lanczos (g = 7, n = 9), about 15 significant digits. */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let sum = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** ln of the Beta(a, b) density at x ∈ (0, 1). */
function logBetaPdf(x: number, a: number, b: number, lbeta: number): number {
  return (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lbeta;
}

/**
 * Continued fraction for the regularized incomplete beta (modified Lentz). Converges in
 * O(√max(a, b)) iterations for x below the mean, which is why the caller flips to the
 * complement above it.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  const EPS = 1e-15;
  const maxIterations = 1000 + Math.ceil(20 * Math.sqrt(Math.max(a, b)));
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b): the Beta(a, b) CDF at x. */
export function betaCdf(x: number, a: number, b: number, lbeta = logBeta(a, b)): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logFront = a * Math.log(x) + b * Math.log1p(-x) - lbeta;
  if (x < (a + 1) / (a + b + 2)) {
    return (Math.exp(logFront) * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (Math.exp(logFront) * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Composite Simpson intervals across the integration window. Even. */
const SIMPSON_INTERVALS = 1000;
/**
 * The integration window ends where the density has fallen to e^−50 of its peak. Beta(a, b) with
 * a, b ≥ 1 is log-concave, so the mass beyond that point is negligible (≪ 1e−15) — unlike a
 * fixed number of standard deviations, which cuts off the heavy side of a skewed posterior
 * such as Beta(501, 1).
 */
const WINDOW_LOG_DROP = 50;

interface BetaParams {
  a: number;
  b: number;
  mean: number;
  sd: number;
  lbeta: number;
}

function posterior(visitors: number, conversions: number): BetaParams {
  const n = Math.max(0, Math.floor(visitors));
  const c = Math.min(n, Math.max(0, Math.floor(conversions)));
  const a = 1 + c;
  const b = 1 + n - c;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { a, b, mean, sd, lbeta: logBeta(a, b) };
}

/**
 * [lo, hi] where the log-density is within `WINDOW_LOG_DROP` of its maximum, by bisection on
 * each side of the mode (the log-density is monotone on each side, being concave).
 */
function densityWindow(p: BetaParams): [number, number] {
  const mode = p.a + p.b > 2 ? (p.a - 1) / (p.a + p.b - 2) : 0.5;
  const logAt = (x: number) => (p.a - 1) * Math.log(x) + (p.b - 1) * Math.log1p(-x);
  const peak = mode > 0 && mode < 1 ? logAt(mode) : 0; // a = 1 or b = 1: the peak sits at an end
  const floor = peak - WINDOW_LOG_DROP;

  const edge = (inside: number, outside: number): number => {
    if (logAt(outside) >= floor) return outside; // ln 0 = −∞ at an end, so only for flat shapes
    let lo = inside;
    let hi = outside;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      if (logAt(mid) >= floor) lo = mid;
      else hi = mid;
    }
    return hi;
  };

  const left = p.a === 1 ? 0 : edge(mode, 0);
  const right = p.b === 1 ? 1 : edge(mode, 1);
  return [left, right];
}

/**
 * P(p_variant > p_control) with p_i ~ Beta(1 + conversions_i, 1 + visitors_i − conversions_i).
 *
 * Computed by deterministic quadrature, not Monte Carlo, so the same counts always render the
 * same digits:
 *
 *   P(X_v > X_c) = ∫ f_c(x)·(1 − F_v(x)) dx = ∫ f_v(x)·F_c(x) dx
 *
 * The *narrower* posterior supplies the density and the wider one the CDF, so the CDF factor
 * varies no faster than the density it is weighted by — otherwise a 100-visitor arm against a
 * million-visitor arm would integrate a near step function on a grid too coarse to see it.
 * The window is where that density is within e^−50 of its peak (`densityWindow`).
 * The CDF is the regularized incomplete beta in log space, so counts up to ~10^7 neither
 * overflow nor lose precision.
 *
 * Counts are clamped to integers with 0 ≤ conversions ≤ visitors. Identical inputs return
 * exactly 0.5.
 */
export function chanceToBeatControl(
  control: Pick<ArmCounts, "visitors" | "conversions">,
  variant: Pick<ArmCounts, "visitors" | "conversions">,
): number {
  const c = posterior(control.visitors, control.conversions);
  const v = posterior(variant.visitors, variant.conversions);
  if (c.a === v.a && c.b === v.b) return 0.5;

  // Narrower posterior is the density; the result is expressed as P(X_v > X_c) either way.
  const densityIsVariant = v.sd < c.sd;
  const dens = densityIsVariant ? v : c;
  const other = densityIsVariant ? c : v;

  const [lo, hi] = densityWindow(dens);
  const h = (hi - lo) / SIMPSON_INTERVALS;

  // Both the weighted integral and the density's own mass are summed on the same grid, and the
  // result is their ratio. That cancels the quadrature's and ln Γ's shared normalisation error
  // (ln Γ(10^7) ≈ 1.5e8, so its last bit is ~3e-8), which otherwise shows up as
  // P(a > b) + P(b > a) drifting from 1.
  let weighted = 0;
  let mass = 0;
  const add = (weight: number, density: number, factor: number) => {
    weighted += weight * density * factor;
    mass += weight * density;
  };
  for (let i = 0; i <= SIMPSON_INTERVALS; i++) {
    const x = lo + i * h;
    const weight = i === 0 || i === SIMPSON_INTERVALS ? 1 : i % 2 === 1 ? 4 : 2;
    if (x <= 0 || x >= 1) {
      // ln x or ln(1 − x) is −∞ here. The density is finite and nonzero at an end only when
      // that end's shape parameter is 1 (Beta(1, b) at 0 is b; Beta(a, 1) at 1 is a), and the CDF
      // factor is exactly 0 or 1 there: F(0) = 0, F(1) = 1.
      const atZero = x <= 0;
      if (atZero ? dens.a !== 1 : dens.b !== 1) continue;
      const cdf = atZero ? 0 : 1;
      add(weight, Math.exp(-dens.lbeta), densityIsVariant ? cdf : 1 - cdf);
      continue;
    }
    const density = Math.exp(logBetaPdf(x, dens.a, dens.b, dens.lbeta));
    if (density === 0) continue;
    const cdf = betaCdf(x, other.a, other.b, other.lbeta);
    // density = f_v → weight F_c(x); density = f_c → weight 1 − F_v(x).
    add(weight, density, densityIsVariant ? cdf : 1 - cdf);
  }
  const p = mass > 0 ? weighted / mass : 0.5;
  return Math.min(1, Math.max(0, p));
}

// ---------------------------------------------------------------------------------------------
// Analysis: gate, best, winner
// ---------------------------------------------------------------------------------------------

export interface ArmResult extends ArmCounts {
  index: number;
  isControl: boolean;
  /** Conversions ÷ assigned visitors (0 when none). */
  rate: number;
  /** Relative lift over Control; null for Control, with no data, or when Control's rate is 0. */
  lift: number | null;
  /** P(beats Control); null for Control and when the experiment has no visitors at all. */
  chance: number | null;
}

export interface ResultsAnalysis {
  arms: ArmResult[];
  control: ArmResult;
  variants: ArmResult[];
  totalVisitors: number;
  totalConversions: number;
  /** Σconversions ÷ Σvisitors; null with no visitors. */
  pooledRate: number | null;
  hasData: boolean;
  /** Every arm has ≥ 1,000 visitors and ≥ 100 conversions. */
  enough: boolean;
  /** Variant with the highest chance (first wins ties); null with no data or no variants. */
  best: ArmResult | null;
  /** Once `enough`: every variant whose chance to beat Control is ≥ 0.95. Empty before the gate. */
  likelyBetter: ArmResult[];
  /**
   * The recommended version: `best`, when `enough`, its chance to beat Control is ≥ 0.95 **and**
   * its chance to beat every other variant is ≥ 0.95 too. With several variants, beating Control
   * is not enough — two variants can both beat it while being indistinguishable from each other,
   * and naming either one would be a coin toss presented as a result.
   */
  winner: ArmResult | null;
  /** `enough`, no winner, and every variant's chance ≤ 0.05. */
  controlWins: boolean;
}

/** True when this arm has passed both per-arm minimums. */
export function armHasEnough(arm: Pick<ArmCounts, "visitors" | "conversions">): boolean {
  return arm.visitors >= MIN_VISITORS_PER_ARM && arm.conversions >= MIN_CONVERSIONS_PER_ARM;
}

/**
 * Everything the results screens derive from the per-arm counts. `arms[0]` is Control.
 * Throws on an empty list — an experiment always has a control arm.
 */
export function analyzeResults(input: readonly ArmCounts[]): ResultsAnalysis {
  if (input.length === 0) throw new RangeError("analyzeResults needs at least the control arm");

  const totalVisitors = input.reduce((t, a) => t + a.visitors, 0);
  const totalConversions = input.reduce((t, a) => t + a.conversions, 0);
  const hasData = totalVisitors > 0;
  const control0 = input[0]!;
  const baseRate = conversionRate(control0.visitors, control0.conversions);

  const arms: ArmResult[] = input.map((arm, index) => {
    const isControl = index === 0;
    const rate = conversionRate(arm.visitors, arm.conversions);
    return {
      ...arm,
      index,
      isControl,
      rate,
      lift: isControl || !hasData ? null : relativeLift(rate, baseRate),
      chance: isControl || !hasData ? null : chanceToBeatControl(control0, arm),
    };
  });

  const control = arms[0]!;
  const variants = arms.slice(1);
  const enough = hasData && arms.every(armHasEnough);

  let best: ArmResult | null = null;
  for (const arm of variants) {
    if (arm.chance === null) continue;
    if (best === null || arm.chance > (best.chance ?? 0)) best = arm;
  }

  const likelyBetter = enough ? variants.filter((arm) => (arm.chance ?? 0) >= WIN_CHANCE) : [];
  const winner =
    best !== null &&
    likelyBetter.includes(best) &&
    variants.every((other) => other === best || chanceToBeatControl(other, best) >= WIN_CHANCE)
      ? best
      : null;
  const controlWins =
    enough &&
    winner === null &&
    variants.length > 0 &&
    variants.every((arm) => (arm.chance ?? 0) <= LOSE_CHANCE);

  return {
    arms,
    control,
    variants,
    totalVisitors,
    totalConversions,
    pooledRate: hasData ? totalConversions / totalVisitors : null,
    hasData,
    enough,
    best,
    likelyBetter,
    winner,
    controlWins,
  };
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

/** A fraction as a percentage with 2 dp ("3.49%"), as the results tables render rates. */
export function formatRate2(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/** A nullable fraction as a 1 dp percentage, "—" when null ("3.8%"). */
export function formatRate1(rate: number | null): string {
  return rate === null || !Number.isFinite(rate) ? "—" : `${(rate * 100).toFixed(1)}%`;
}

/** Relative lift: "+12.3%", "−4.0%" (U+2212), "—" when null. */
export function formatLift(lift: number | null): string {
  if (lift === null || !Number.isFinite(lift)) return "—";
  return `${lift >= 0 ? "+" : MINUS}${Math.abs(lift * 100).toFixed(1)}%`;
}

/**
 * Chance to beat Control as a percentage: "97.4%" at 1 dp, "—" when null.
 *
 * Capped at ">99.9%" / "<0.1%" (at `dp` decimals) rather than rounding to "100.0%" or "0.0%":
 * the posterior never reaches certainty and the screen should not say it did.
 */
export function formatChance(chance: number | null, dp = 1): string {
  if (chance === null || !Number.isFinite(chance)) return "—";
  const step = 10 ** -dp; // in percent
  const pct = chance * 100;
  const max = 100 - step;
  if (Number(pct.toFixed(dp)) > max) return `>${max.toFixed(dp)}%`;
  if (Number(pct.toFixed(dp)) < step) return `<${step.toFixed(dp)}%`;
  return `${pct.toFixed(dp)}%`;
}

/**
 * Percentage points vs control, 1 dp: "+0.6 pts vs control", "−0.2 pts vs control".
 * A difference that rounds to zero renders "0.0 pts vs control" — unsigned, so it is neither
 * green nor red (the screens colour notes by their first character).
 */
export function formatPtsVsControl(pts: number): string {
  const rounded = Number(pts.toFixed(1));
  if (rounded === 0) return "0.0 pts vs control";
  return `${rounded > 0 ? "+" : MINUS}${Math.abs(rounded).toFixed(1)} pts vs control`;
}

/** The note colour the list and project dashboard use: green "+", red "−", grey otherwise. */
export function noteTone(note: string): "positive" | "negative" | "neutral" {
  if (note.startsWith("+")) return "positive";
  if (note.startsWith(MINUS)) return "negative";
  return "neutral";
}

// ---------------------------------------------------------------------------------------------
// Row verdict pill (wizard results tables)
// ---------------------------------------------------------------------------------------------

export type RowVerdict =
  "" | "Needs more data" | "Likely better" | "Likely worse" | "Not significant yet";

/** Control and no-data rows get no pill; otherwise the gate decides before the chance does. */
export function rowVerdict(arm: ArmResult, analysis: ResultsAnalysis): RowVerdict {
  if (arm.isControl || !analysis.hasData || arm.chance === null) return "";
  if (!analysis.enough) return "Needs more data";
  if (arm.chance >= WIN_CHANCE) return "Likely better";
  if (arm.chance <= LOSE_CHANCE) return "Likely worse";
  return "Not significant yet";
}

/** Badge on the winning row of the detail table: "Likely winner" while live, "Winner" once ended. */
export function winnerBadge(status: ResultStatus): "Likely winner" | "Winner" {
  return status === "completed" ? "Winner" : "Likely winner";
}

// ---------------------------------------------------------------------------------------------
// The detail-page verdict (six rows, top-down)
// ---------------------------------------------------------------------------------------------

export type VerdictKind = "collect" | "win" | "flat" | "wait";

export interface Verdict {
  kind: VerdictKind;
  title: string;
  body: string;
}

export interface VerdictContext {
  status: ResultStatus;
  /** e.g. "Sep 30" — used only by a completed experiment with a winner. */
  endedLabel?: string;
  /** Days run (`ranDays`) — used only by a completed experiment with a winner. */
  days?: number;
}

const GATE_SENTENCE = `${formatNumber(MIN_VISITORS_PER_ARM)} visitors and ${MIN_CONVERSIONS_PER_ARM} conversions`;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The verdict banner on `/experiments/[id]`, evaluated top-down:
 *
 * | # | Condition   | Kind    | Title |
 * |---|-------------|---------|-------|
 * | 1 | no visitors | collect | "Collecting data" |
 * | 2 | winner      | win     | "<W> won" / "<W> is likely better than Control" |
 * | 3 | controlWins | win     | "Control is likely better" |
 * | 3b| likelyBetter, no winner | flat | "<B> and <C> are likely better than Control" — no single winner |
 * | 4 | enough      | flat    | "No clear winner" / "No clear winner yet" |
 * | 5 | completed   | wait    | "Ended before a result" |
 * | 6 | otherwise   | wait    | "Not enough data to call a winner yet" |
 *
 * The design's held-back variant of row 1 is not built (D6).
 */
export function experimentVerdict(analysis: ResultsAnalysis, ctx: VerdictContext): Verdict {
  const { control, winner, best, arms } = analysis;
  const isDone = ctx.status === "completed";
  const pausedNote = ctx.status === "paused" ? " It’s paused, so no new data is coming in." : "";

  if (!analysis.hasData) {
    return {
      kind: "collect",
      title: "Collecting data",
      body: "No visitors yet. Results appear here as soon as visitors reach the tested page.",
    };
  }

  if (winner) {
    const winText = `${winner.name} converts ${((winner.lift ?? 0) * 100).toFixed(1)}% better than Control (${formatRate2(winner.rate)} vs ${formatRate2(control.rate)}), with a ${formatChance(winner.chance)} chance to beat it.`;
    if (isDone) {
      const ended =
        ctx.endedLabel !== undefined && ctx.days !== undefined
          ? `Ended ${ctx.endedLabel} after ${plural(ctx.days, "day", "days")}. `
          : "";
      return { kind: "win", title: `${winner.name} won`, body: `${ended}${winText}` };
    }
    return {
      kind: "win",
      title: `${winner.name} is likely better than Control`,
      body: `${winText} Every version has passed ${GATE_SENTENCE}, so you can end the test and update your site to ${winner.name}.`,
    };
  }

  if (analysis.controlWins) {
    return {
      kind: "win",
      title: "Control is likely better",
      body: `No variant beats Control. Every version has enough data, and Control converts at ${formatRate2(control.rate)}.`,
    };
  }

  if (analysis.likelyBetter.length > 0) {
    return { kind: "flat", ...noSingleWinner(analysis, isDone) };
  }

  if (analysis.enough) {
    const rates = arms.map((a) => `${a.name} ${formatRate2(a.rate)}`).join(" vs ");
    const bestText = best
      ? ` ${best.name} has a ${formatChance(best.chance, 0)} chance to beat Control.`
      : "";
    return {
      kind: "flat",
      title: isDone ? "No clear winner" : "No clear winner yet",
      body: `Every version has enough data, but the difference isn’t significant (${rates}).${bestText}${pausedNote}`,
    };
  }

  if (isDone) {
    const lead = leaderByRate(analysis);
    return {
      kind: "wait",
      title: "Ended before a result",
      body: `This experiment ended before every version reached ${GATE_SENTENCE}, so Routely didn’t call a winner. ${lead.name} was ahead at ${formatRate2(lead.rate)}, but the difference could be chance.`,
    };
  }

  return {
    kind: "wait",
    title: "Not enough data to call a winner yet",
    body: `Each version needs at least ${GATE_SENTENCE} before Routely suggests a winner. ${
      ctx.status === "paused"
        ? "It’s paused, so no new data is coming in. Resume it to keep collecting."
        : "Early differences often disappear, so keep the experiment running."
    }`,
  };
}

/**
 * Some variants beat Control but none is clearly ahead of the rest (`likelyBetter` without a
 * `winner`). Naming one would be a coin toss, so the copy names the group and the closest call.
 */
function noSingleWinner(analysis: ResultsAnalysis, isDone: boolean): Omit<Verdict, "kind"> {
  const group = analysis.likelyBetter;
  const best = analysis.best!;
  const rival = analysis.variants
    .filter((arm) => arm !== best)
    .map((arm) => ({ arm, chance: chanceToBeatControl(arm, best) }))
    .sort((a, b) => a.chance - b.chance)[0];
  const names = joinNames(group.map((arm) => arm.name));
  const verb = group.length === 1 ? "is" : "are";
  const close = rival
    ? ` ${best.name} has only a ${formatChance(rival.chance)} chance to beat ${rival.arm.name}, so no single version is clearly best.`
    : "";
  return {
    title: `${names} ${verb} likely better than Control`,
    body: `Every version has enough data.${close} ${
      isDone
        ? "Routely didn’t name a winner."
        : "Keep the experiment running to separate them, or choose a winner yourself."
    }`,
  };
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------------------------
// Choosing a winner
// ---------------------------------------------------------------------------------------------

/**
 * Whether a chosen version was Routely's recommendation (`recommended`) or the team's own call
 * (`manual`). Recorded when the choice is made (`Experiment.winnerBasis`); results are frozen once
 * an experiment ends, so it stays true.
 */
export type WinnerBasis = "recommended" | "manual";

/**
 * What Routely recommends keeping: the gated winner, or Control when every variant is likely
 * worse. Null whenever the data cannot single one out — not enough of it, no clear difference, or
 * several variants tied ahead of Control.
 */
export function recommendedArm(analysis: ResultsAnalysis): ArmResult | null {
  return analysis.winner ?? (analysis.controlWins ? analysis.control : null);
}

export function winnerBasis(analysis: ResultsAnalysis, armIndex: number): WinnerBasis {
  return recommendedArm(analysis)?.index === armIndex ? "recommended" : "manual";
}

/**
 * Why choosing this arm is not backed by the data, or null when it is the recommendation. Shown
 * in the choose-winner dialog before the choice and on the results afterwards — a manual pick is
 * never presented as a result.
 */
export function manualChoiceCaveat(analysis: ResultsAnalysis, armIndex: number): string | null {
  const recommended = recommendedArm(analysis);
  if (recommended?.index === armIndex) return null;
  if (!analysis.hasData) return "There’s no data yet, so this choice isn’t based on results.";
  if (!analysis.enough) {
    return `Not every version has reached ${GATE_SENTENCE}, so the data can’t tell the versions apart yet.`;
  }
  if (recommended) {
    return recommended.isControl
      ? "Every variant is likely worse than Control, so the data points the other way."
      : `The data favours ${recommended.name}, with a ${formatChance(recommended.chance)} chance to beat Control.`;
  }
  return "No version is clearly better than the others, so the data doesn’t single one out.";
}

export interface WinnerDecision {
  armIndex: number;
  basis: WinnerBasis;
  /** "Dana Lee"; null when the member has since been deleted or the reader may not see names. */
  chosenBy: string | null;
  /** "Oct 27". */
  chosenLabel: string;
}

/**
 * The verdict once a winner has been chosen. A recommended choice reads as a result ("<W> won");
 * a manual one says whose call it was and why the data does not back it — never "won".
 */
export function decisionVerdict(analysis: ResultsAnalysis, decision: WinnerDecision): Verdict {
  const arm = analysis.arms[decision.armIndex] ?? analysis.control;
  const when = `on ${decision.chosenLabel}`;
  const chose = (what: string) =>
    decision.chosenBy ? `${decision.chosenBy} chose ${what} ${when}` : `${what} was chosen ${when}`;
  if (decision.basis === "recommended") {
    const evidence = arm.isControl
      ? `Every variant was likely worse than Control, which converted at ${formatRate2(arm.rate)}.`
      : `${arm.name} converted ${((arm.lift ?? 0) * 100).toFixed(1)}% better than Control (${formatRate2(arm.rate)} vs ${formatRate2(analysis.control.rate)}), with a ${formatChance(arm.chance)} chance to beat it, after every version passed ${GATE_SENTENCE}.`;
    return {
      kind: "win",
      title: arm.isControl ? "Control won" : `${arm.name} won`,
      body: `${evidence} ${chose(decision.chosenBy ? "it" : "It")} as the winner, as Routely recommended.`,
    };
  }
  const caveat = manualChoiceCaveat(analysis, decision.armIndex) ?? "";
  return {
    kind: "flat",
    title: `${arm.name} chosen as the winner`,
    body: `${chose(arm.name)}. ${caveat} This is a judgement call, not a statistically reliable result.`,
  };
}

/** A stored choice (`Experiment.winner*`) as the notes take it; null when none was made. */
export function storedDecision(
  stored: {
    winnerChosenAt: Date | null;
    winnerVariantId: string | null;
    winnerBasis: "RECOMMENDED" | "MANUAL" | null;
  },
  variantIds: readonly string[],
): Pick<WinnerDecision, "armIndex" | "basis"> | null {
  if (!stored.winnerChosenAt || !stored.winnerBasis) return null;
  const at = stored.winnerVariantId === null ? -1 : variantIds.indexOf(stored.winnerVariantId);
  return {
    armIndex: at + 1,
    basis: stored.winnerBasis === "RECOMMENDED" ? "recommended" : "manual",
  };
}

/** The table badge on the chosen row: earned ("Winner") or the team's call ("Chosen"). */
export function decisionBadge(basis: WinnerBasis): "Winner" | "Chosen" {
  return basis === "recommended" ? "Winner" : "Chosen";
}

/** The arm with the highest rate; Control wins ties (it comes first). */
export function leaderByRate(analysis: ResultsAnalysis): ArmResult {
  let lead = analysis.arms[0]!;
  for (const arm of analysis.arms) if (arm.rate > lead.rate) lead = arm;
  return lead;
}

/**
 * The verdict banner in the wizards' results phases (A/B and Split URL). Same gate and kinds as
 * the detail page; the wizards' own wording where the design gave one.
 *
 * Deviations from the design, both deliberate: the Split URL banner had no gate (unified on the
 * detail page's, §8.2), and the A/B banner's "goal page views" reads "conversions" because that
 * is what is counted — at most one per visitor.
 */
export function wizardVerdict(analysis: ResultsAnalysis, type: "ab" | "split"): Verdict {
  const { winner } = analysis;

  if (!analysis.hasData) {
    return {
      kind: "collect",
      title: "Collecting data",
      body:
        type === "ab"
          ? "Results appear here once visitors reach your page. This usually takes a few minutes after launch."
          : "Results appear here once visitors reach your Control page. This usually takes a few minutes after launch. Avoid judging a winner until each version has a meaningful number of conversions.",
    };
  }

  if (!analysis.enough) {
    return {
      kind: "wait",
      title: "Not enough data to call a winner yet",
      body: `Each version needs at least ${GATE_SENTENCE} before Routely suggests a winner. Early differences often disappear as more data comes in, so keep the experiment running.`,
    };
  }

  if (winner) {
    return {
      kind: "win",
      title: `${winner.name} is likely better than Control`,
      body:
        `${winner.name} is converting ${Math.abs((winner.lift ?? 0) * 100).toFixed(1)}% better than Control, with a ${formatChance(winner.chance)} chance to beat it.` +
        (analysis.variants.length > 1 ? " It’s also likely ahead of every other variant." : ""),
    };
  }

  if (analysis.likelyBetter.length > 0) {
    return { kind: "flat", ...noSingleWinner(analysis, false) };
  }

  if (analysis.controlWins) {
    return {
      kind: "win",
      title: "Control is likely better",
      body: `No variant beats Control. Every version has enough data, and Control converts at ${formatRate2(analysis.control.rate)}.`,
    };
  }

  return {
    kind: "flat",
    title: "No clear winner yet",
    body:
      type === "ab"
        ? "You have enough data, but no variant is clearly better or worse than Control. Keep the experiment running or try a bolder change."
        : "None of the variants is clearly better or worse than Control yet. Keep the experiment running to collect more data.",
  };
}

// ---------------------------------------------------------------------------------------------
// Smaller result phrases used around the detail page
// ---------------------------------------------------------------------------------------------

/** The "Result" fact in the pause dialog. */
export function pauseResultLabel(analysis: ResultsAnalysis): string {
  if (analysis.winner) return `${analysis.winner.name} likely better`;
  if (analysis.enough) return "No clear winner yet";
  return "Not enough data yet";
}

/** The Review tab's "Completed on …" health sentence about the outcome. */
export function completedOutcomeSentence(analysis: ResultsAnalysis): string {
  if (analysis.winner) {
    return `${analysis.winner.name} won with a ${formatChance(analysis.winner.chance)} chance to beat Control.`;
  }
  if (analysis.controlWins) return "Control won — no variant beat it.";
  if (analysis.enough) return "There was no clear winner.";
  return "It ended before there was enough data for a result.";
}

/** Conversions the furthest-behind arm still needs to reach the gate ("about K more"). */
export function conversionsStillNeeded(arms: readonly Pick<ArmCounts, "conversions">[]): number {
  return arms.reduce((k, a) => Math.max(k, MIN_CONVERSIONS_PER_ARM - a.conversions), 0);
}

export interface ArmProgress {
  /** "1,240 / 1,000" */
  visitorsLabel: string;
  /** 0..1, for the bar width. */
  visitorsFraction: number;
  visitorsMet: boolean;
  /** "43 / 100" */
  conversionsLabel: string;
  conversionsFraction: number;
  conversionsMet: boolean;
}

/** The per-arm progress bars a `wait` verdict shows. */
export function armProgress(arm: Pick<ArmCounts, "visitors" | "conversions">): ArmProgress {
  return {
    visitorsLabel: `${formatNumber(arm.visitors)} / ${formatNumber(MIN_VISITORS_PER_ARM)}`,
    visitorsFraction: Math.min(1, arm.visitors / MIN_VISITORS_PER_ARM),
    visitorsMet: arm.visitors >= MIN_VISITORS_PER_ARM,
    conversionsLabel: `${formatNumber(arm.conversions)} / ${formatNumber(MIN_CONVERSIONS_PER_ARM)}`,
    conversionsFraction: Math.min(1, arm.conversions / MIN_CONVERSIONS_PER_ARM),
    conversionsMet: arm.conversions >= MIN_CONVERSIONS_PER_ARM,
  };
}

// ---------------------------------------------------------------------------------------------
// List / project-dashboard note
// ---------------------------------------------------------------------------------------------

/**
 * The short note under the conversion rate on `/experiments` (`surface: "list"`) and on
 * `/projects/[id]` (`surface: "project"`):
 *
 * | Status            | Condition         | Note |
 * |-------------------|-------------------|------|
 * | draft             | —                 | list `""`; project "no result yet" |
 * | any other         | 0 visitors        | list "no data yet"; project "no result yet" |
 * | running           | !enough           | "collecting data" |
 * | paused            | !enough           | "paused before a result" |
 * | running or paused | enough            | "+0.6 pts vs control" (best variant − control, 1 dp, U+2212) |
 * | completed         | winner chosen     | recommended: "variant won" / "<name> won" / "control won"; manual: "<name> chosen" / "control kept" |
 * | completed         | winner            | "variant won" (multi-variant: "<name> won") |
 * | completed         | controlWins       | "control won" |
 * | completed         | enough, no winner | "no clear winner" |
 * | completed         | !enough           | "ended before a result" |
 *
 * The two surfaces differ only where their designs do (draft and no-data rows).
 */
export function resultNote(
  analysis: ResultsAnalysis,
  status: ResultStatus,
  surface: "list" | "project",
  decision: Pick<WinnerDecision, "armIndex" | "basis"> | null = null,
): string {
  if (status === "draft") return surface === "list" ? "" : "no result yet";

  if (status === "completed" && decision) {
    const arm = analysis.arms[decision.armIndex] ?? analysis.control;
    if (decision.basis === "manual") return arm.isControl ? "control kept" : `${arm.name} chosen`;
    if (arm.isControl) return "control won";
    return analysis.variants.length === 1 ? "variant won" : `${arm.name} won`;
  }
  if (!analysis.hasData) return surface === "list" ? "no data yet" : "no result yet";

  if (status === "completed") {
    if (analysis.winner) {
      return analysis.variants.length === 1 ? "variant won" : `${analysis.winner.name} won`;
    }
    if (analysis.controlWins) return "control won";
    if (analysis.enough) return "no clear winner";
    return "ended before a result";
  }

  if (!analysis.enough) return status === "paused" ? "paused before a result" : "collecting data";
  const best = analysis.best ?? analysis.variants[0];
  if (!best) return "";
  return formatPtsVsControl(deltaPts(best.rate, analysis.control.rate));
}

// ---------------------------------------------------------------------------------------------
// Cumulative conversion-rate series
// ---------------------------------------------------------------------------------------------

/** One arm's counts on one UTC day. `armKey` is the variant id, or null for Control. */
export interface ArmDayCounts {
  day: UtcDayKey;
  armKey: string | null;
  visitors: number;
  conversions: number;
}

export interface CumulativeSeries {
  /** Every UTC day from the first to the last, inclusive, oldest first. */
  days: UtcDayKey[];
  /** One entry per requested arm, in the order given. */
  arms: {
    armKey: string | null;
    /** Σconversions(≤ d) ÷ Σvisitors(≤ d); null until the arm has its first visitor. */
    rates: (number | null)[];
    /** Σvisitors(≤ d) — handy for tooltips and for the last-point-equals-table check. */
    visitors: number[];
    conversions: number[];
  }[];
}

const DAY_MS = 86_400_000;

/**
 * Builds the "Conversion rate over time · Cumulative, by version" series from per-day rows.
 * Days with no row are zero-filled; rows outside [from, to] are ignored. `from`/`to` are
 * instants (publishedAt and endedAt-or-now) bucketed to their UTC day.
 *
 * Assignments are bucketed by `assignedAt` and conversions by `occurredAt`, so a day's rate is
 * the ratio of two running totals rather than a per-cohort rate. The last point equals the
 * table's rate whenever the rows cover the whole run.
 */
export function cumulativeSeries(
  rows: readonly ArmDayCounts[],
  armKeys: readonly (string | null)[],
  from: Date,
  to: Date,
): CumulativeSeries {
  const first = Date.parse(`${utcDayKey(from)}T00:00:00.000Z`);
  const last = Date.parse(`${utcDayKey(to)}T00:00:00.000Z`);
  const days: UtcDayKey[] = [];
  for (let t = first; t <= last; t += DAY_MS) days.push(utcDayKey(new Date(t)));
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const perArm = new Map<string | null, { v: number[]; c: number[] }>();
  for (const key of armKeys) {
    perArm.set(key, {
      v: new Array<number>(days.length).fill(0),
      c: new Array<number>(days.length).fill(0),
    });
  }
  for (const row of rows) {
    if (!isUtcDayKey(row.day)) continue;
    const i = dayIndex.get(row.day);
    const bucket = perArm.get(row.armKey);
    if (i === undefined || !bucket) continue;
    bucket.v[i]! += row.visitors;
    bucket.c[i]! += row.conversions;
  }

  return {
    days,
    arms: armKeys.map((armKey) => {
      const bucket = perArm.get(armKey)!;
      let v = 0;
      let c = 0;
      const rates: (number | null)[] = [];
      const visitors: number[] = [];
      const conversions: number[] = [];
      for (let i = 0; i < days.length; i++) {
        v += bucket.v[i]!;
        c += bucket.c[i]!;
        rates.push(v > 0 ? c / v : null);
        visitors.push(v);
        conversions.push(c);
      }
      return { armKey, rates, visitors, conversions };
    }),
  };
}

/** The chart is drawn only with data and at least two days; otherwise its empty state shows. */
export function showCumulativeChart(hasData: boolean, days: number): boolean {
  return hasData && days >= MIN_CHART_DAYS;
}
