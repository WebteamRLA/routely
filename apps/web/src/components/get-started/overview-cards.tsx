import Link from "next/link";

import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { OverviewStats } from "@/server/services/overview.service";

/**
 * The figures above the websites table: where the account stands this cycle, and what its
 * experiments have produced this year.
 *
 * Drawn as the design's KPI strip — white tiles separated by 1px hairlines rather than as
 * separate cards — so the row reads as one instrument rather than as a row of competing panels.
 *
 * Every number is derived from rows at request time — see `overview.service.ts`. The one thing
 * that is *not* measured is the tracked-user allowance, because Routely has no billing yet;
 * it is a named constant in the service, and this component only renders it.
 */

/** The 1px-gap container: its background shows through the gaps as the dividing rules. */
const STRIP =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden bg-border";

/** "View usage →" — the tile's onward action, styled as the design's 13px blue section link. */
function TileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-sm text-[13px] font-bold whitespace-nowrap text-primary outline-none hover:text-brand-hover focus-visible:ring-3 focus-visible:ring-primary/15"
    >
      {children} →
    </Link>
  );
}

function Tile({
  label,
  value,
  unit,
  sub,
  action,
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-card px-[22px] py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate text-[12.5px] font-bold text-ink-3">{label}</h3>
        {action}
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="font-heading text-[30px] leading-[1.1] font-bold tracking-[-0.02em] tabular-nums">
          {value}
        </span>
        {unit ? <span className="text-[13px] font-semibold text-ink-3">{unit}</span> : null}
      </p>
      {children}
      <p className="text-[12.5px] text-pretty text-ink-3">{sub}</p>
    </div>
  );
}

/** "2 experiments" / "1 experiment" — the counts under the performance figures. */
function experimentCount(n: number): string {
  return `${formatNumber(n)} experiment${n === 1 ? "" : "s"}`;
}

/** Mean relative change, signed, or a dash when nothing could be measured. */
function formatUplift(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

export function OverviewCards({ stats }: { stats: OverviewStats }) {
  const running = stats.liveExperiments > 0;

  return (
    <>
      <div className={cn(STRIP, "rounded-lg border border-border")}>
        <Tile
          label="Tracked users this cycle"
          value={formatNumber(stats.trackedUsers)}
          unit="users"
          action={<TileLink href={routes.experiments.list}>View usage</TileLink>}
          sub="Counted against your monthly plan allowance"
        >
          <div className="space-y-1.5 pt-1">
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-divider">
              <div
                className="h-full rounded-[3px] bg-primary"
                style={{
                  width: `${Math.max(stats.usageRatio * 100, stats.trackedUsers > 0 ? 2 : 0)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-ink-3 tabular-nums">
                {(stats.usageRatio * 100).toFixed(0)}% of {formatNumber(stats.trackedUserAllowance)}
              </span>
              <span
                className={cn(
                  "font-extrabold",
                  stats.usageOnTrack ? "text-success-text" : "text-warning-text",
                )}
              >
                {stats.usageOnTrack ? "On track" : "Near limit"}
              </span>
            </div>
          </div>
        </Tile>

        <Tile
          label={running ? "Experiments running" : "Nothing running yet"}
          value={formatNumber(stats.liveExperiments)}
          unit="live"
          action={<TileLink href={routes.experiments.new()}>New experiment</TileLink>}
          sub={
            running
              ? "Collecting results while they stay published"
              : "Launch an experiment to start collecting results"
          }
        />

        <Tile
          label="Drafts ready to launch"
          value={formatNumber(stats.draftExperiments)}
          unit={stats.draftExperiments === 1 ? "draft" : "drafts"}
          action={
            <TileLink href={`${routes.experiments.list}?status=draft`}>Review drafts</TileLink>
          }
          sub="Built but never started collecting traffic"
        />
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">Performance</h2>
            <span className="text-[12.5px] text-ink-3">All experiments · {stats.year}</span>
          </div>
          <TileLink href={routes.experiments.list}>View full report</TileLink>
        </div>

        <div className={STRIP}>
          <Tile
            label="Conversions"
            value={formatNumber(stats.conversions)}
            sub={experimentCount(stats.measuredExperiments)}
          />
          <Tile
            label="Average uplift"
            value={formatUplift(stats.averageUplift)}
            sub={experimentCount(stats.upliftExperiments)}
          />
          <Tile
            label="Visitors in experiments"
            value={formatNumber(stats.visitorsInExperiments)}
            sub={experimentCount(stats.measuredExperiments)}
          />
        </div>
      </section>
    </>
  );
}
