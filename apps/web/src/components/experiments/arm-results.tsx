import { armBg } from "@/components/experiments/arm-colors";
import { formatNumber } from "@/lib/format";
import type { ArmStats } from "@/server/services/analytics.service";
import { cn } from "@/lib/utils";

/**
 * One arm of an experiment, as a KPI tile in the results strip.
 *
 * The experiment's primary metric — conversion rate by default, or time on page / page views if
 * chosen instead — is given the most visual weight via `heroLabel`/`heroValue`/`heroHint`,
 * because it is the number the decision turns on. Every other metric is listed in the
 * comparison table beneath the strip; the choice only changes what is emphasised, not what is
 * measured.
 *
 * Meant to sit inside a container with a 1px gap on the border colour (see `ExperimentResults`),
 * which draws the dividers between tiles.
 */
export function ArmResults({
  label,
  url,
  share,
  stats,
  leading = false,
  heroLabel,
  heroValue,
  heroHint,
  colorIndex = 0,
  change,
}: {
  label: string;
  url: string;
  /** Percentage of traffic sent to this arm. */
  share: number;
  stats: ArmStats;
  /** Whether this arm currently leads on the experiment's primary metric. Descriptive only. */
  leading?: boolean;
  /** Name of the experiment's primary metric, e.g. "Conversion rate". */
  heroLabel: string;
  /** The primary metric's formatted value for this arm. */
  heroValue: string;
  /** What the hero value is measured against, e.g. "42 of 120 assigned visitors". */
  heroHint: string;
  /** Position in the arm palette; 0 is control. */
  colorIndex?: number;
  /** Footer line: relative change against control, already formatted by the caller. */
  change?: { text: string; tone: "good" | "bad" | "neutral"; note: string };
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-[1_1_220px] flex-col gap-2.5 px-5 pt-4 pb-[18px] tabular-nums",
        leading ? "bg-success-bg-2" : "bg-card",
      )}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", armBg(colorIndex))} />

      <div className="flex min-h-5 flex-wrap items-center gap-2">
        <span className="text-[11.5px] font-extrabold tracking-[0.1em] uppercase">{label}</span>
        <span className="text-xs font-semibold text-ink-3">{share}% of traffic</span>
        {leading ? (
          <span className="rounded-sm bg-success-bg px-1.5 py-0.5 text-[10.5px] font-extrabold tracking-[0.05em] text-success-text uppercase">
            Currently ahead
          </span>
        ) : null}
      </div>

      <p className="truncate font-mono text-[11.5px] text-ink-3" title={url}>
        {url}
      </p>

      <div>
        <p className="font-heading text-[30px] leading-[1.1] font-bold tracking-[-0.02em]">
          {heroValue}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">{heroLabel}</p>
        <p className="mt-0.5 text-xs text-ink-3">{heroHint}</p>
      </div>

      <div className="flex gap-5 text-[13px]">
        <div>
          <p className="text-xs text-ink-3">Assigned</p>
          <p className="font-extrabold">{formatNumber(stats.assignedVisitors)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-3">Conversions</p>
          <p className="font-extrabold">{formatNumber(stats.conversions)}</p>
        </div>
      </div>

      {change ? (
        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-2.5 border-t border-divider pt-2.5">
          <span
            className={cn(
              "font-heading text-lg font-bold",
              change.tone === "good" && "text-success-text",
              change.tone === "bad" && "text-danger-text",
              change.tone === "neutral" && "text-ink-3",
            )}
          >
            {change.text}
          </span>
          <span className="text-[12.5px] font-semibold text-ink-2">{change.note}</span>
        </div>
      ) : null}
    </div>
  );
}
