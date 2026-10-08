"use client";

import { useState, type MouseEvent } from "react";

import { ArmSwatch, Section, UnderlineTabs } from "@/components/rl";

import type { ChartMetric, ChartModel } from "./model";

const TABS: { key: ChartMetric; label: string }[] = [
  { key: "cr", label: "Conversion rate" },
  { key: "visitors", label: "Visitors" },
  { key: "conversions", label: "Conversions" },
];

/** Cumulative line chart with metric tabs, legend and a hover crosshair (prototype L1432–1456). */
export function ResultsChart({
  model,
  metric,
  onMetric,
  armNames,
  goalName,
}: {
  model: ChartModel | null;
  metric: ChartMetric;
  onMetric: (metric: ChartMetric) => void;
  armNames: string[];
  goalName: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = model?.n ?? 0;
  const hasHover = model != null && hover != null && hover < n;
  const fr = hasHover && n > 1 ? hover / (n - 1) : 0;

  function onMove(ev: MouseEvent<HTMLDivElement>) {
    if (!model || n < 1) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const j = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - r.left) / r.width) * (n - 1))));
    if (j !== hover) setHover(j);
  }

  const note =
    metric === "cr"
      ? "Cumulative conversion rate. Lines settle as more visitors arrive."
      : metric === "visitors"
        ? "Cumulative visitors assigned to each variant."
        : `Cumulative conversions for ${goalName}.`;

  return (
    <Section clip>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-divider px-[18px] pt-3">
        <UnderlineTabs
          size="sm"
          ariaLabel="Chart metric"
          tabs={TABS}
          active={metric}
          onSelect={(key) => {
            setHover(null);
            onMetric(key as ChartMetric);
          }}
        />
        <div className="flex flex-wrap gap-3.5 pb-2.5">
          {model?.legend.map((l) => (
            <span key={l.name} className="flex items-center gap-1.5 text-[12.5px]">
              <span className="h-[3px] w-3.5 rounded-xs" style={{ background: l.color }} />
              <span className="font-bold">{l.name}</span>
              <span className="text-ink-3 tabular-nums">{l.val}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="pt-[18px] pr-[18px] pb-3 pl-16">
        <div
          data-testid="results-chart"
          className="relative h-60"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {model?.yTicks.map((y, i) => (
            <div
              key={i}
              className="absolute inset-x-0 border-t border-dashed border-border"
              style={{ top: y.top }}
            >
              <span className="absolute -top-2 -left-14 w-12 text-right text-[11px] text-faint tabular-nums">
                {y.label}
              </span>
            </div>
          ))}
          <svg
            viewBox="0 0 600 200"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            role="img"
            aria-label={`${TABS.find((t) => t.key === metric)?.label} over time`}
          >
            {model?.series.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {hasHover && model ? (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-navy opacity-35"
                style={{ left: `${fr * 100}%` }}
              />
              <div
                data-testid="chart-tooltip"
                className="pointer-events-none absolute top-2 min-w-[170px] rounded-lg bg-navy px-3 py-2.5 text-[12.5px] text-white shadow-[0_8px_24px_rgba(10,22,51,0.25)]"
                style={
                  fr > 0.6
                    ? { right: `calc(${100 - fr * 100}% + 12px)` }
                    : { left: `calc(${fr * 100}% + 12px)` }
                }
              >
                <div className="mb-1.5 font-extrabold">{model.dates[hover]}</div>
                {model.series.map((s, i) => (
                  <div key={i} className="mt-[3px] flex items-center gap-2">
                    <ArmSwatch size={8} color={s.color} />
                    <span className="flex-1">{armNames[i]}</span>
                    <span className="font-extrabold tabular-nums">
                      {model.format(s.pts[hover] ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="mt-2 flex justify-between">
          {model?.xLabels.map((x, i) => (
            <span key={i} className="text-[11px] text-faint">
              {x}
            </span>
          ))}
        </div>
        <div className="mt-2.5 text-xs text-ink-3">{note}</div>
      </div>
    </Section>
  );
}
