"use client";

import { useState } from "react";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OverviewCharts } from "@/server/services/overview.service";

/**
 * The two figures below the websites table.
 *
 * Built as inline SVG rather than pulled from a charting library: both are a single series of
 * at most a few dozen points, the app has no charting dependency today, and adding one for
 * this would ship a large bundle to every page for two small pictures.
 *
 * Colour follows the design's arm palette — brand blue (arm A) for visitors, teal (arm C) for
 * conversions — one hue per chart. Neither chart has a second series, so identity never rests
 * on colour: the title names the measure, and every bar carries a direct label. Gridlines are
 * the design's dashed #EEF0F4 rules, labelled in 11–12px mono so figures line up.
 */

function CardShell({
  title,
  meta,
  value,
  aside,
  children,
}: {
  title: string;
  meta: string;
  value: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">{title}</h2>
          <span className="text-[12.5px] text-ink-3 tabular-nums">{meta}</span>
        </div>
        {aside}
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 pt-4 pb-5">
        <p className="font-heading text-[30px] leading-[1.1] font-bold tracking-[-0.02em] tabular-nums">
          {value}
        </p>
        <div className="min-h-[9rem] flex-1">{children}</div>
      </div>
    </section>
  );
}

/** Shown where a chart would be when there is nothing to draw: the empty axes, and why. */
function EmptyPlot({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[9rem] flex-col justify-between">
      <div aria-hidden className="flex flex-1 flex-col justify-between py-2">
        <span className="border-t border-dashed border-divider" />
        <span className="border-t border-dashed border-divider" />
        <span className="border-t border-divider" />
      </div>
      <p className="pt-3 text-[13.5px] text-ink-3">{message}</p>
    </div>
  );
}

/**
 * Conversions per running experiment.
 *
 * Horizontal bars: the categories are experiment names, which are long and of uneven length,
 * and a horizontal axis gives them room to be read rather than rotated.
 */
function ConversionBars({ data }: { data: OverviewCharts["conversionsByExperiment"] }) {
  const max = Math.max(...data.map((row) => row.conversions), 1);

  return (
    <ul className="space-y-3.5">
      {data.map((row) => (
        <li key={row.experimentId} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13.5px] font-bold" title={row.name}>
              {row.name}
            </span>
            {/* Direct label on every bar: with one series there is no legend, and a value the
             * reader has to estimate off an axis is a value they will estimate wrongly. */}
            <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums">
              {formatNumber(row.conversions)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-divider">
            <div
              className="h-full rounded-[3px] bg-arm-c"
              style={{
                width: `${Math.max((row.conversions / max) * 100, row.conversions > 0 ? 3 : 0)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Rounds an axis maximum up to 1, 2 or 5 × 10ⁿ, so gridline labels are round numbers. */
function niceCeiling(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Unique visitors per day.
 *
 * An area chart with a 2px line: a continuous measure over evenly spaced days, where the shape
 * of the trend is the point and individual days are read on hover rather than from labels.
 *
 * The SVG stretches to its box (`preserveAspectRatio="none"`, non-scaling strokes) so the plot
 * fills any card width; text and the hover marker are HTML positioned in percentages, so they
 * are never distorted by that stretch.
 */
function VisitorArea({ data }: { data: OverviewCharts["visitorTrend"] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 600;
  const H = 150;
  const top = niceCeiling(Math.max(...data.map((day) => day.visitors), 1));
  const ticks = top % 2 === 0 ? [top, top / 2, 0] : [top, 0];
  const step = data.length > 1 ? W / (data.length - 1) : 0;

  const x = (index: number) => index * step;
  const y = (value: number) => H - (value / top) * H;
  const xPct = (index: number) => (data.length > 1 ? (index / (data.length - 1)) * 100 : 0);
  const yPct = (value: number) => 100 - (value / top) * 100;

  const line = data
    .map((day, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(day.visitors)}`)
    .join(" ");
  const area = `${line} L${x(data.length - 1)},${H} L${x(0)},${H} Z`;

  const active = hover === null ? null : data[hover];
  const first = data[0];
  const last = data[data.length - 1];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative min-h-[9rem] flex-1" onMouseLeave={() => setHover(null)}>
        {/* Gridlines with their values, drawn behind the plot. */}
        {ticks.map((tick) => (
          <div
            key={tick}
            aria-hidden
            className={cn(
              "absolute inset-x-0 border-t border-divider",
              tick === 0 ? "border-solid border-border" : "border-dashed",
            )}
            style={{ top: `${yPct(tick)}%` }}
          >
            {tick !== 0 ? (
              <span className="absolute top-0.5 left-0 font-mono text-[11px] text-faint tabular-nums">
                {formatNumber(tick)}
              </span>
            ) : null}
          </div>
        ))}

        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible text-arm-a"
          role="img"
          aria-label={`Unique visitors per day over the last ${data.length} days`}
        >
          <path d={area} fill="currentColor" fillOpacity="0.08" />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Hit targets far wider than the 2px line, so a day is easy to land on. */}
          {data.map((day, index) => (
            <rect
              key={day.date.toISOString()}
              x={x(index) - step / 2}
              y={0}
              width={Math.max(step, 8)}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>

        {active && hover !== null ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-navy/30"
              style={{ left: `${xPct(hover)}%` }}
            />
            {/* 2px surface ring so the marker stays visible over the area fill. */}
            <span
              aria-hidden
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-arm-a"
              style={{ left: `${xPct(hover)}%`, top: `${yPct(active.visitors)}%` }}
            />
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 font-mono text-[12px] text-ink-3 tabular-nums">
        <span>{first ? shortDate(first.date) : ""}</span>
        <span aria-live="polite" className="min-w-0 truncate text-center font-sans font-semibold">
          {active
            ? `${shortDate(active.date)} · ${formatNumber(active.visitors)} unique visitor${active.visitors === 1 ? "" : "s"}`
            : `Last ${data.length} days`}
        </span>
        <span>{last ? shortDate(last.date) : ""}</span>
      </div>
    </div>
  );
}

export function OverviewChartCards({ charts }: { charts: OverviewCharts }) {
  const hasConversions = charts.conversionsByExperiment.length > 0;
  const hasVisitors = charts.visitorTotal > 0;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
      <CardShell
        title="Conversions by running experiment"
        meta={String(charts.year)}
        value={formatNumber(charts.conversionsTotal)}
      >
        {hasConversions ? (
          <ConversionBars data={charts.conversionsByExperiment} />
        ) : (
          <EmptyPlot message="No conversions recorded yet." />
        )}
      </CardShell>

      <CardShell
        title="Visitors over time"
        meta={`${charts.visitorDailyAverage.toFixed(charts.visitorDailyAverage < 10 ? 1 : 0)} avg/day`}
        value={formatNumber(charts.visitorTotal)}
        aside={
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-bold text-ink-3">
            <span aria-hidden className="h-0.5 w-3 rounded-full bg-arm-a" />
            Unique visitors
          </span>
        }
      >
        {hasVisitors ? (
          <VisitorArea data={charts.visitorTrend} />
        ) : (
          <EmptyPlot
            message={`No experiment traffic recorded in the last ${charts.trendDays} days.`}
          />
        )}
      </CardShell>
    </div>
  );
}
