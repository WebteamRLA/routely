"use client";

import { useState } from "react";

import type { VisitorPoint } from "@/components/dashboard/model";
import { fDate, fN } from "@/lib/format";

const W = 600;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

/** A rounded axis maximum and three gridlines under it. */
function scale(max: number): number[] {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max / 3 || 1));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 3 >= max) ?? step * 10;
  return [0, nice, nice * 2, nice * 3];
}

/**
 * "Visitors over time": visitors newly assigned to any of the project's experiments per day,
 * over the last 30 days in the project's time zone, with the total, the daily average and a
 * hover read-out for each day.
 */
export function VisitorsCard({ points }: { points: VisitorPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = points.reduce((t, p) => t + p.visitors, 0);
  const avg = points.length ? total / points.length : 0;
  const ticks = scale(Math.max(0, ...points.map((p) => p.visitors)));
  const top = ticks[ticks.length - 1]! || 1;

  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * iw : iw / 2);
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.visitors).toFixed(1)}`)
    .join(" ");
  const area = points.length
    ? `${line} L${x(points.length - 1).toFixed(1)},${PAD.top + ih} L${x(0).toFixed(1)},${PAD.top + ih} Z`
    : "";
  const label = (day: string) => fDate(`${day}T12:00:00Z`);
  const hovered = hover !== null ? points[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / iw) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  }

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card px-5 pt-5 pb-4 shadow-[0_1px_2px_rgba(10,22,51,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">
          Visitors over time
        </h2>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[20px] border border-border px-2.5 py-1 text-xs font-bold text-ink-2">
          <span aria-hidden className="size-1.5 rounded-full bg-brand" />
          Visitors assigned
        </span>
      </div>
      <div className="mt-2 font-heading text-[26px] leading-none font-bold tracking-[-0.02em] tabular-nums">
        {fN(total)}
      </div>
      <div className="text-right text-xs text-ink-3 tabular-nums">
        {avg >= 10 ? fN(avg) : avg.toFixed(1).replace(/\.0$/, "")} avg/day
      </div>

      {total ? (
        <div className="relative mt-3 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${fN(total)} visitors assigned in the last ${points.length} days`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="rl-visitors-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2B59F0" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#2B59F0" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="#EEF0F4"
                  strokeDasharray={t ? "3 4" : undefined}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  className="fill-faint font-mono text-[11px]"
                >
                  {fN(t)}
                </text>
              </g>
            ))}
            <path d={area} fill="url(#rl-visitors-fill)" />
            <path d={line} fill="none" stroke="#2B59F0" strokeWidth="2" strokeLinejoin="round" />
            {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                className="fill-ink-3 font-mono text-[11px]"
              >
                {label(points[i]!.day)}
              </text>
            ))}
            {hovered ? (
              <g>
                <line
                  x1={x(hover!)}
                  x2={x(hover!)}
                  y1={PAD.top}
                  y2={PAD.top + ih}
                  stroke="#0A1633"
                  strokeOpacity="0.25"
                />
                <circle
                  cx={x(hover!)}
                  cy={y(hovered.visitors)}
                  r="4"
                  fill="#FFFFFF"
                  stroke="#2B59F0"
                  strokeWidth="2"
                />
              </g>
            ) : null}
          </svg>
          {hovered ? (
            <div
              className="pointer-events-none absolute top-1 rounded-md bg-navy px-2.5 py-1.5 text-xs font-bold whitespace-nowrap text-white shadow-[0_8px_20px_rgba(10,22,51,0.25)]"
              style={
                hover! > points.length / 2
                  ? { right: `${100 - (x(hover!) / W) * 100 + 2}%` }
                  : { left: `${(x(hover!) / W) * 100 + 2}%` }
              }
            >
              {label(hovered.day)} · {fN(hovered.visitors)} visitors
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid min-h-[240px] flex-1 place-items-center text-center text-[13px] text-ink-3">
          No experiment traffic recorded in the last {points.length} days.
        </div>
      )}
    </section>
  );
}
