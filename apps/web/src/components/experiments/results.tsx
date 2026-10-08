import type { ReactNode } from "react";

import { armBg, displayPath } from "@/components/experiments/arm-colors";
import { ArmResults } from "@/components/experiments/arm-results";
import type { PrimaryMetric } from "@/generated/prisma/enums";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ArmStats } from "@/server/services/analytics.service";

/**
 * Control against every variant.
 *
 * ## Why there is no significance test here
 *
 * A p-value or a confidence interval would be the honest way to say "this difference is real",
 * and computing one is not the hard part — choosing it correctly is. A test run continuously
 * and read whenever the numbers look good is wrong regardless of the statistics behind it
 * (the peeking problem), and a badly-chosen test lends false authority to exactly the mistake
 * it appears to prevent.
 *
 * So this shows which arm is *currently* ahead and says plainly that it is not proof. A
 * descriptive statement a reader can weigh is better than an inferential one they will trust
 * more than it deserves.
 */

/** One redirect target's results, already zipped with its url/label/share by the caller. */
export interface VariantResult {
  variantId: string;
  url: string;
  /** "Variant 1", "Variant 2"… derived from position, not stored anywhere. */
  label: string;
  /** Percentage of total site traffic sent to this arm. */
  share: number;
  stats: ArmStats;
}

/**
 * Below this many assigned visitors per arm, the comparison is not worth reading at all.
 *
 * Not a significance threshold — there is no test here. It is the point below which random
 * variation dominates so completely that showing a leader would mislead: with 20 visitors an
 * arm, a single conversion swings the rate by five points.
 */
const MIN_VISITORS_FOR_COMPARISON = 30;

/**
 * What "currently ahead" is judged on. Every metric is always collected regardless of an
 * experiment's `primaryMetric` — this only selects which one the leader alert reads from.
 */
const METRIC_META: Record<
  PrimaryMetric,
  {
    /** Lower-case, for inline sentences: "…is currently leading on {label}". */
    label: string;
    /** Title-case, for the arm card's own heading. */
    heroLabel: string;
    extract: (stats: ArmStats) => number | null;
    format: (value: number | null) => string;
    hint: (stats: ArmStats) => string;
  }
> = {
  CONVERSION_RATE: {
    label: "conversion rate",
    heroLabel: "Conversion rate",
    extract: (stats) => stats.conversionRate,
    format: formatPercent,
    hint: (stats) =>
      stats.assignedVisitors === 0
        ? "No visitors assigned yet"
        : `${formatNumber(stats.conversions)} of ${formatNumber(stats.assignedVisitors)} assigned visitor${stats.assignedVisitors === 1 ? "" : "s"}`,
  },
  TIME_ON_PAGE: {
    label: "average time on page",
    heroLabel: "Avg. time on page",
    extract: (stats) => stats.avgVisibleMs,
    format: formatDuration,
    hint: (stats) =>
      stats.pageViews === 0
        ? "No page views yet"
        : `Across ${formatNumber(stats.pageViews)} page view${stats.pageViews === 1 ? "" : "s"} (approx.)`,
  },
  PAGE_VIEWS: {
    label: "page views per visitor",
    heroLabel: "Page views per visitor",
    extract: (stats) => stats.viewsPerVisitor,
    format: (value) => (value === null ? "—" : value.toFixed(2)),
    hint: (stats) =>
      stats.visitors === 0
        ? "No visitors yet"
        : `${formatNumber(stats.pageViews)} page views across ${formatNumber(stats.visitors)} visitor${stats.visitors === 1 ? "" : "s"}`,
  },
};

/** Same formula as `analytics.service.ts`'s `relativeLift`, generalised to any metric here so
 * the leader alert can describe whichever one is primary, not only conversion rate. */
function relativeChange(control: number | null, variant: number | null): number | null {
  if (control === null || variant === null) return null;
  if (control === 0) return null;
  return (variant - control) / control;
}

interface Arm {
  /** `null` is control; a variant's id otherwise. */
  key: string | null;
  label: string;
  url: string;
  /** Percentage of total site traffic sent to this arm. */
  share: number;
  stats: ArmStats;
}

/** A relative change as "+12.3%" / "−4.0%", with the tone it should be read in. */
function formatChange(change: number | null): { text: string; tone: "good" | "bad" | "neutral" } {
  if (change === null || !Number.isFinite(change)) return { text: "—", tone: "neutral" };
  const flat = Math.abs(change) < 0.005;
  const sign = flat ? "" : change > 0 ? "+" : "−";
  return {
    text: `${sign}${Math.abs(change * 100).toFixed(1)}%`,
    tone: flat ? "neutral" : change > 0 ? "good" : "bad",
  };
}

/** How far the observed split may drift from the planned one before it is worth a look.
 * A heuristic prompt to check the install, not a statistical test. */
const SPLIT_TOLERANCE_POINTS = 3;

const TONE_TEXT = {
  good: "text-success-text",
  bad: "text-danger-text",
  neutral: "text-ink-3",
} as const;

export function ExperimentResults({
  control,
  controlShare,
  variants,
  isEmpty,
  controlUrl,
  primaryMetric,
  isDraft,
  controls,
}: {
  control: ArmStats;
  /** Percentage of total site traffic left on the control page. */
  controlShare: number;
  variants: VariantResult[];
  isEmpty: boolean;
  controlUrl: string;
  primaryMetric: PrimaryMetric;
  isDraft: boolean;
  /** Optional controls for the verdict panel, e.g. the reporting-period picker. */
  controls?: ReactNode;
}) {
  if (isEmpty) {
    return (
      <div className="flex flex-col gap-[18px]">
        {controls ? <div className="flex justify-end">{controls}</div> : null}
        <div className="flex flex-col items-center gap-2.5 rounded-lg border border-border bg-card px-6 py-10 text-center">
          {isDraft ? (
            <div aria-hidden className="flex gap-1.5">
              <span className="h-[46px] w-[34px] rounded-md bg-brand" />
              <span className="h-[46px] w-[34px] rounded-md bg-coral" />
            </div>
          ) : (
            <span
              aria-hidden
              className="size-[34px] animate-rl-spin rounded-full border-[3px] border-[#D5DEFB] border-t-primary"
            />
          )}
          <h2 className="font-heading text-[19px] font-semibold">
            {isDraft ? "No results yet" : "Waiting for the first visitors"}
          </h2>
          <p className="max-w-[480px] leading-relaxed text-pretty text-ink-3">
            {isDraft
              ? "Publish the experiment and make sure the tracking snippet is installed on every page to start collecting results."
              : "Results appear here once visitors reach the control page with the snippet installed. If nothing arrives, check the snippet is present on the control, variant and conversion pages."}
          </p>
        </div>
      </div>
    );
  }

  const arms: Arm[] = [
    { key: null, label: "Control", url: controlUrl, share: controlShare, stats: control },
    ...variants.map((variant) => ({
      key: variant.variantId,
      label: variant.label,
      url: variant.url,
      share: variant.share,
      stats: variant.stats,
    })),
  ];

  const meta = METRIC_META[primaryMetric];
  const extracted = arms.map((arm) => ({ arm, value: meta.extract(arm.stats) }));
  const smallSample = arms.some((arm) => arm.stats.assignedVisitors < MIN_VISITORS_FOR_COMPARISON);
  const controlValue = meta.extract(control);

  // A leader is only named once every arm has enough traffic, has actually recorded this
  // metric, and is not tied with another arm for the top value — otherwise the difference is
  // noise wearing a number's clothes, or there is nothing to call a "leader" at all.
  let leadingArm: Arm | null = null;
  if (!smallSample && extracted.every((entry) => entry.value !== null)) {
    const max = Math.max(...extracted.map((entry) => entry.value as number));
    const winners = extracted.filter((entry) => entry.value === max);
    if (winners.length === 1) leadingArm = winners[0]!.arm;
  }

  /** Relative change against control on the primary metric — withheld while the sample is too
   * small for the comparison to mean anything, the same rule that withholds a leader. */
  function changeFor(arm: Arm) {
    if (arm.key === null) return { text: "Baseline", tone: "neutral" as const, note: "" };
    if (smallSample) return { text: "—", tone: "neutral" as const, note: "too few visitors" };
    return {
      ...formatChange(relativeChange(controlValue, meta.extract(arm.stats))),
      note: "vs control",
    };
  }

  const verdict = leadingArm
    ? leadingArm.key === null
      ? {
          pill: "Control ahead · not proof",
          surface: "border-danger-border bg-danger-bg-2",
          pillColor: "text-danger-text",
        }
      : {
          pill: "Currently ahead · not proof",
          surface: "border-success-border bg-success-bg-2",
          pillColor: "text-success-text",
        }
    : smallSample
      ? { pill: "Collecting data", surface: "border-border bg-card", pillColor: "text-ink-2" }
      : { pill: "No clear leader", surface: "border-border bg-[#F5F6F9]", pillColor: "text-ink-2" };

  // Observed against planned split, among visitors entered into the experiment.
  const totalAssigned = arms.reduce((sum, arm) => sum + arm.stats.assignedVisitors, 0);
  const totalShare = arms.reduce((sum, arm) => sum + arm.share, 0);
  const actual = arms.map((arm) =>
    totalAssigned > 0 ? arm.stats.assignedVisitors / totalAssigned : 0,
  );
  const planned = arms.map((arm) => (totalShare > 0 ? arm.share / totalShare : 1 / arms.length));
  const drift = Math.max(...actual.map((value, index) => Math.abs(value - planned[index]!)));
  const splitCheck =
    totalAssigned < MIN_VISITORS_FOR_COMPARISON * 2
      ? {
          text: "Too few visitors to compare the actual split with the plan yet.",
          color: "text-ink-3",
        }
      : drift * 100 > SPLIT_TOLERANCE_POINTS
        ? {
            text: `Actual split differs from the plan by more than ${SPLIT_TOLERANCE_POINTS} points. Check the snippet is installed on every page and the variant URLs load.`,
            color: "text-warning-text",
          }
        : {
            text: `Actual split is within ${SPLIT_TOLERANCE_POINTS} points of the plan.`,
            color: "text-success-text",
          };

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Verdict hero: a description of the numbers so far, never a significance claim. */}
      <section
        className={cn(
          "flex flex-wrap items-end justify-between gap-5 rounded-xl border p-[clamp(18px,2.5vw,28px)]",
          verdict.surface,
        )}
      >
        <div className="min-w-0 flex-[1_1_420px]">
          <p
            className={cn(
              "text-[11.5px] font-extrabold tracking-[0.1em] uppercase",
              verdict.pillColor,
            )}
          >
            {verdict.pill}
          </p>
          {leadingArm ? (
            <>
              <h2 className="mt-1.5 mb-2 font-heading text-[clamp(22px,2.6vw,30px)] font-bold tracking-[-0.02em] text-pretty">
                {leadingArm.key === null ? "Control" : leadingArm.label} is currently leading on{" "}
                {meta.label}
              </h2>
              <p className="max-w-[680px] text-[15px] leading-relaxed text-pretty text-[#2E3A52]">
                {meta.format(meta.extract(leadingArm.stats))}
                {leadingArm.key !== null ? (
                  <>
                    {" "}
                    against {meta.format(controlValue)} (
                    <strong
                      className={
                        TONE_TEXT[
                          formatChange(relativeChange(controlValue, meta.extract(leadingArm.stats)))
                            .tone
                        ]
                      }
                    >
                      {
                        formatChange(relativeChange(controlValue, meta.extract(leadingArm.stats)))
                          .text
                      }
                    </strong>{" "}
                    relative to control)
                  </>
                ) : null}
                . This is a description of the numbers so far,{" "}
                <strong>not statistical proof</strong>. Routely does not test for significance, and
                a lead can reverse as more visitors arrive — so treat it as a signal to keep
                watching, not a result to act on.
              </p>
            </>
          ) : smallSample ? (
            <>
              <h2 className="mt-1.5 mb-2 font-heading text-[clamp(22px,2.6vw,30px)] font-bold tracking-[-0.02em] text-pretty">
                Too little traffic to compare yet
              </h2>
              <p className="max-w-[680px] text-[15px] leading-relaxed text-pretty text-[#2E3A52]">
                With fewer than {MIN_VISITORS_FOR_COMPARISON} visitors in an arm, a single
                conversion moves the rate by several points. The numbers below are accurate; the
                comparison between them is not yet meaningful.
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-1.5 mb-2 font-heading text-[clamp(22px,2.6vw,30px)] font-bold tracking-[-0.02em] text-pretty">
                No arm is ahead on {meta.label}
              </h2>
              <p className="max-w-[680px] text-[15px] leading-relaxed text-pretty text-[#2E3A52]">
                Every arm has enough visitors, but no single arm has the highest {meta.label} — the
                top arms are tied, or one has not recorded this metric yet.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          {controls}
          <p className="text-xs text-ink-3">
            Judged on {meta.label} · {formatNumber(totalAssigned)} assigned visitor
            {totalAssigned === 1 ? "" : "s"}
          </p>
        </div>
      </section>

      {/* KPI strip: one tile per arm, divided by 1px gaps on the border colour. */}
      <div className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-border bg-border">
        {arms.map((arm, index) => (
          <ArmResults
            key={arm.key ?? "control"}
            label={arm.label}
            url={arm.url}
            share={arm.share}
            stats={arm.stats}
            leading={leadingArm?.key === arm.key}
            heroLabel={meta.heroLabel}
            heroValue={meta.format(meta.extract(arm.stats))}
            heroHint={meta.hint(arm.stats)}
            colorIndex={index}
            change={changeFor(arm)}
          />
        ))}
      </div>

      {/* Every metric, every arm. */}
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5 border-b border-divider px-[18px] py-3.5">
          <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">
            Variant comparison
          </h2>
          <span className="text-[12.5px] text-ink-3">Lift is on {meta.label}, against control</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-[13.5px] tabular-nums">
            <thead>
              <tr className="table-head border-b border-divider bg-subtle">
                <th className="px-[18px] py-2.5 text-left font-extrabold">Version</th>
                <th className="px-3 py-2.5 text-right font-extrabold">Traffic</th>
                <th className="px-3 py-2.5 text-right font-extrabold">Assigned</th>
                <th className="px-3 py-2.5 text-right font-extrabold">Unique visitors</th>
                <th className="px-3 py-2.5 text-right font-extrabold">Page views</th>
                <th className="px-3 py-2.5 text-right font-extrabold">Avg. time (approx.)</th>
                <th className="px-3 py-2.5 text-right font-extrabold">Conversions</th>
                <th className="px-3 py-2.5 text-right font-extrabold">Conv. rate</th>
                <th className="py-2.5 pr-[18px] pl-3 text-right font-extrabold">Lift</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm, index) => {
                const change = changeFor(arm);
                const leading = leadingArm?.key === arm.key;
                return (
                  <tr
                    key={arm.key ?? "control"}
                    className={cn(
                      "border-b border-divider last:border-b-0",
                      leading && "bg-success-bg-2",
                    )}
                  >
                    <td className="max-w-[260px] px-[18px] py-3.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden
                          className={cn("size-2.5 shrink-0 rounded-[3px]", armBg(index))}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold whitespace-nowrap">{arm.label}</span>
                            {leading ? (
                              <span className="rounded-sm bg-success-bg px-1.5 py-0.5 text-[10.5px] font-extrabold tracking-[0.05em] text-success-text uppercase">
                                Ahead
                              </span>
                            ) : null}
                          </div>
                          <p
                            className="truncate font-mono text-[11.5px] text-ink-3"
                            title={arm.url}
                          >
                            {displayPath(arm.url)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-right text-ink-2">{arm.share}%</td>
                    <td className="px-3 py-3.5 text-right font-semibold">
                      {formatNumber(arm.stats.assignedVisitors)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-semibold">
                      {formatNumber(arm.stats.visitors)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-semibold">
                      {formatNumber(arm.stats.pageViews)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-semibold">
                      {formatDuration(arm.stats.avgVisibleMs)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-semibold">
                      {formatNumber(arm.stats.conversions)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-extrabold">
                      {formatPercent(arm.stats.conversionRate)}
                    </td>
                    <td
                      className={cn(
                        "py-3.5 pr-[18px] pl-3 text-right font-extrabold",
                        TONE_TEXT[change.tone],
                      )}
                    >
                      {change.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Observed split against the configured one. */}
      <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-[18px]">
        <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">
          Traffic distribution
        </h2>
        <div>
          <p className="mb-1.5 text-xs font-bold text-ink-3">Actual assigned visitors</p>
          <div className="flex h-[30px] gap-0.5 overflow-hidden rounded-[7px]">
            {arms.map((arm, index) => (
              <div
                key={arm.key ?? "control"}
                className={cn(
                  "flex items-center justify-center overflow-hidden text-xs font-extrabold whitespace-nowrap text-white",
                  armBg(index),
                )}
                style={{ flex: Math.max(actual[index]!, 0.0001) }}
                title={`${arm.label} ${formatPercent(actual[index]!)}`}
              >
                {actual[index]! > 0.12 ? `${arm.label} ${formatPercent(actual[index]!)}` : ""}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold text-ink-3">
            Planned {planned.map((value) => `${Math.round(value * 100)}%`).join(" / ")} of visitors
            entered into the test
          </p>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded opacity-55">
            {arms.map((arm, index) => (
              <div
                key={arm.key ?? "control"}
                className={armBg(index)}
                style={{ flex: Math.max(planned[index]!, 0.0001) }}
              />
            ))}
          </div>
        </div>
        <p className={cn("text-[12.5px] font-bold", splitCheck.color)}>{splitCheck.text}</p>
      </section>

      <p className="text-xs text-pretty text-ink-3">
        Conversion rate is conversions divided by assigned visitors. Average time on page is
        approximate — it measures how long the browser reported the page as visible, which is not
        the same as attention, and is comparable between arms but not against other tools. Traffic
        is each arm&rsquo;s planned share of total site traffic. Lift compares a variant&rsquo;s{" "}
        {meta.label} with control&rsquo;s — it is arithmetic, not a significance test.
      </p>
    </div>
  );
}
