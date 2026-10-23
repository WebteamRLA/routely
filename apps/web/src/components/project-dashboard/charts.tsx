"use client";

import { useState, type ReactNode } from "react";

import { ACCENT, ACCENT_LINE } from "@/components/rt/styles";
import { fmt, type DayPoint, type PdExperiment } from "@/lib/project-dashboard";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type LoadState = "data" | "loading" | "error";

const sectionClass = "flex min-w-0 flex-col gap-4 rounded-xl border border-[#EEF0F3] bg-white p-5";
const skel = "block animate-[rt-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none";
const tooltipClass =
  "pointer-events-none absolute z-[3] rounded-lg border border-[#E5E7EB] bg-white whitespace-nowrap text-[#111827] shadow-[0_8px_24px_#1118271F,0_1px_3px_#1118270F]";

function Placeholder({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[224px] flex-col items-center justify-center gap-2.5 rounded-lg bg-[#F9FAFB] p-4 text-center">
      <span
        aria-hidden
        className="inline-flex size-10 items-center justify-center rounded-full bg-[#F3F4F6] text-[#4B5563]"
      >
        {icon}
      </span>
      <div className="flex max-w-[320px] flex-col gap-1">
        <p className="m-0 text-sm leading-[1.45] font-semibold text-[#111827]">{title}</p>
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#4B5563]">{body}</p>
      </div>
      {children}
    </div>
  );
}

function ChartError() {
  return (
    <div className="flex min-h-[224px] flex-col items-center justify-center gap-2 rounded-lg bg-[#F9FAFB] p-4 text-center">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#B91C1C"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5" />
        <path d="M12 16.2v.3" />
      </svg>
      <p className="m-0 text-sm leading-[1.45] font-semibold text-[#111827]">
        Chart data unavailable
      </p>
      <p className="m-0 text-[13px] leading-[19px] text-[#4B5563]">
        It will appear once the page reloads.
      </p>
    </div>
  );
}

function ChartHead({ id, title, caption }: { id: string; title: string; caption: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h2 id={id} className="m-0 text-base leading-6 font-semibold text-[#111827]">
        {title}
      </h2>
      <p className="m-0 text-[13px] leading-5 text-[#6B7280]">{caption}</p>
    </div>
  );
}

/**
 * Horizontal bars: goal completions per running experiment, longest first. The values are the
 * table rows' own counts (all-arm conversions since launch), so a bar and its row always agree.
 */
export function ConversionsChart({
  state,
  experiments,
  noExps,
}: {
  state: LoadState;
  experiments: PdExperiment[];
  noExps: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const ready = state === "data";
  const running = experiments
    .filter((e) => e.status === "running" && e.visitors > 0 && e.rate != null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      visitors: e.visitors,
      rate: e.rate!,
      conv: e.conversions,
    }))
    .sort((a, b) => b.conv - a.conv);
  const maxConv = running.reduce((m, r) => Math.max(m, r.conv), 0);

  return (
    <section aria-labelledby="rt-conv-title" className={sectionClass}>
      <div className="flex min-h-11 flex-col gap-0.5">
        <h2 id="rt-conv-title" className="m-0 text-base leading-6 font-semibold text-[#111827]">
          Conversions by running experiment
        </h2>
        <p className="m-0 text-[13px] leading-5 text-[#6B7280]">
          Goal completions since each experiment started
        </p>
      </div>

      {ready && running.length > 0 ? (
        <div
          role="list"
          aria-label="Conversions per running experiment"
          className="flex min-h-[224px] flex-col justify-center"
        >
          {running.map((r) => {
            const on = !hover || hover === r.id;
            const w = maxConv ? Math.max(2, (r.conv / maxConv) * 76) : 0;
            const width = `${w.toFixed(2)}%`;
            return (
              <div
                key={r.id}
                role="listitem"
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                className="flex h-11 items-center"
              >
                <div className="flex w-[172px] min-w-0 flex-[0_0_172px] flex-col pr-3 max-[641px]:w-[112px] max-[641px]:basis-[112px]">
                  <span className="truncate text-[13px] leading-[18px] font-medium text-[#374151]">
                    {r.name}
                  </span>
                  <span className="truncate text-xs leading-4 text-[#6B7280]">
                    {r.rate.toFixed(1)}% conversion rate
                  </span>
                </div>
                <div className="relative flex h-full min-w-0 flex-auto items-center gap-2 border-l border-[#D1D5DB]">
                  <div
                    aria-hidden
                    className="h-5 flex-[0_1_auto] rounded-r transition-[width,background] duration-300"
                    style={{ width, background: on ? ACCENT : ACCENT_LINE }}
                  />
                  <span className="text-[13px] font-semibold text-[#111827] tabular-nums">
                    {fmt(r.conv)}
                  </span>
                  {hover === r.id ? (
                    <div
                      role="tooltip"
                      className={cn(
                        tooltipClass,
                        "bottom-[calc(50%+14px)] -translate-x-1/2 px-2.5 py-1.5 text-xs leading-[17px]",
                      )}
                      style={{ left: width }}
                    >
                      {fmt(r.conv)} conversions · {fmt(r.visitors)} visitors
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {ready && running.length === 0 ? (
        <Placeholder
          icon={
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 20h16" />
              <path d="M6 16v-5" />
              <path d="M11 16V6" />
              <path d="M16 16v-8" />
            </svg>
          }
          title={noExps ? "No running experiments" : "No conversions yet"}
          body={
            noExps
              ? "Launch an experiment to compare conversions here."
              : "Conversions appear here once visitors in a running experiment complete a goal."
          }
        />
      ) : null}

      {state === "loading" ? (
        <div aria-hidden className="flex min-h-[224px] flex-col justify-center gap-[22px]">
          {["62%", "40%", "33%", "22%"].map((w) => (
            <div key={w} className="flex items-center gap-3">
              <span className={cn(skel, "h-3 flex-[0_0_140px] rounded-md bg-[#EEF0F3]")} />
              <span className={cn(skel, "h-5 rounded-r bg-[#F3F4F6]")} style={{ width: w }} />
            </div>
          ))}
        </div>
      ) : null}

      {state === "error" ? <ChartError /> : null}
    </section>
  );
}

const RANGES = [
  { n: 7, label: "7D", aria: "Last 7 days" },
  { n: 30, label: "30D", aria: "Last 30 days" },
  { n: 90, label: "90D", aria: "Last 90 days" },
] as const;

/**
 * Line chart of daily tracked visitors with a 7/30/90-day toggle and a hover read-out.
 *
 * The caption counts **distinct** visitors over the range (`totals`, D8), not the sum of the daily
 * points: a visitor who came back on three days is one visitor, which is also what Projects and
 * the Dashboard show for the same 30 days. `state` "error" for the chart alone shows the chart's
 * own error, so a failed visitor query does not blank the rest of the page.
 */
export function VisitorsChart({
  state,
  series,
  totals,
  domain,
  onSetUpPixel,
}: {
  state: LoadState;
  series: DayPoint[] | null;
  totals: Record<7 | 30 | 90, number> | null;
  domain: string;
  onSetUpPixel(): void;
}) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const ready = state === "data";
  const visReady = ready && !!series;
  const meta = RANGES.find((r) => r.n === range)!;

  let chart: ReactNode = null;
  let caption = `Daily visitors tracked on ${domain}`;
  if (visReady) {
    const n = range;
    const pts = series.slice(series.length - n);
    const total = totals?.[n] ?? pts.reduce((a, x) => a + x.v, 0);
    const vmax = pts.reduce((m, x) => Math.max(m, x.v), 0);
    const minV = pts.reduce((m, x) => Math.min(m, x.v), Infinity);
    caption = `${fmt(total)} visitors · ${meta.aria.toLowerCase()}`;
    // The design's steps start at 250, which flattens a small site's line against the axis; below
    // that the same "at most 4 intervals" rule picks from finer steps. Charts with the design's
    // volumes (≥ ~230 a day) are unchanged.
    const STEPS = vmax * 1.08 <= 250 ? [5, 10, 25, 50, 100, 250] : [250, 500, 1000, 2000, 5000];
    let step = 5000;
    for (const s of STEPS) {
      if (Math.ceil((vmax * 1.08) / s) <= 4) {
        step = s;
        break;
      }
    }
    const ymax = Math.max(step, Math.ceil((vmax * 1.08) / step) * step);
    const X = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500);
    const Y = (v: number) => 200 - (v / ymax) * 200;
    const line = pts
      .map((pt, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(pt.v).toFixed(1)}`)
      .join(" ");
    const area = `${line} L1000 200 L0 200 Z`;
    const yTicks: { label: string; bottom: string; line: string }[] = [];
    for (let t = 0; t <= ymax; t += step) {
      yTicks.push({
        label: t >= 1000 ? `${t / 1000}K` : String(t),
        bottom: `${((t / ymax) * 100).toFixed(2)}%`,
        line: t === 0 ? "#D1D5DB" : "#F3F4F6",
      });
    }
    const every = n === 7 ? 1 : n === 30 ? 5 : 15;
    const tickIdx: number[] = [];
    for (let j = n - 1; j >= 0; j -= every) tickIdx.unshift(j);
    const hasHover = hoverIdx != null && hoverIdx >= 0 && hoverIdx < n;
    const hIdx = hasHover ? hoverIdx : n - 1;
    const hp = pts[hIdx]!;
    const hx = `${(X(hIdx) / 10).toFixed(2)}%`;
    const hy = `${((hp.v / ymax) * 100).toFixed(2)}%`;

    const move = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setHoverIdx(Math.round(f * (n - 1)));
    };

    chart = (
      <div className="flex min-h-[224px] flex-col gap-2">
        <div className="flex h-[200px]">
          <div aria-hidden className="relative w-10 flex-[0_0_40px]">
            {yTicks.map((t) => (
              <span
                key={t.label}
                className="absolute right-2.5 translate-y-1/2 text-xs leading-[14px] text-[#6B7280] tabular-nums"
                style={{ bottom: t.bottom }}
              >
                {t.label}
              </span>
            ))}
          </div>
          <div
            role="img"
            aria-label={`Line chart of daily visitors, ${meta.aria.toLowerCase()}, ranging from ${fmt(minV)} to ${fmt(vmax)} per day.`}
            onMouseMove={move}
            onClick={move}
            onMouseLeave={() => setHoverIdx(null)}
            className="relative min-w-0 flex-auto cursor-crosshair"
          >
            {yTicks.map((t) => (
              <div
                key={t.label}
                aria-hidden
                className="absolute inset-x-0 h-px"
                style={{ bottom: t.bottom, background: t.line }}
              />
            ))}
            <svg
              aria-hidden
              viewBox="0 0 1000 200"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
            >
              <path d={area} fill={ACCENT} fillOpacity="0.1" stroke="none" />
              <path
                d={line}
                fill="none"
                stroke={ACCENT}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {hasHover ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-[#9CA3AF]"
                style={{ left: hx }}
              />
            ) : null}
            <div
              aria-hidden
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full shadow-[0_0_0_2px_#FFFFFF]"
              style={{ left: hx, bottom: hy, background: ACCENT }}
            />
            {hasHover ? (
              <div
                role="tooltip"
                className={cn(tooltipClass, "top-1 flex flex-col gap-px px-2.5 py-[7px]")}
                style={{
                  left: hx,
                  transform: X(hIdx) > 600 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
                }}
              >
                <span className="text-xs leading-4 text-[#6B7280]">
                  {DAYS[hp.d.getDay()]}, {MONTHS[hp.d.getMonth()]} {hp.d.getDate()}
                </span>
                <span className="text-[13px] leading-[18px] font-semibold tabular-nums">
                  {fmt(hp.v)} visitors
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div aria-hidden className="relative ml-10 h-4">
          {tickIdx.map((i) => (
            <span
              key={i}
              className="absolute top-0 text-xs leading-4 whitespace-nowrap text-[#6B7280]"
              style={{
                left: `${(X(i) / 10).toFixed(2)}%`,
                transform:
                  i === n - 1
                    ? "translateX(-100%)"
                    : i === 0
                      ? "translateX(0)"
                      : "translateX(-50%)",
              }}
            >
              {MONTHS[pts[i]!.d.getMonth()]} {pts[i]!.d.getDate()}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="rt-vis-title" className={sectionClass}>
      <div className="flex min-h-11 flex-wrap items-start justify-between gap-3">
        <ChartHead id="rt-vis-title" title="Visitors over time" caption={caption} />
        {visReady ? (
          <div
            role="group"
            aria-label="Time range"
            className="inline-flex gap-0.5 rounded-lg bg-[#F1F3F5] p-[3px]"
          >
            {RANGES.map((r) => {
              const on = r.n === range;
              return (
                <button
                  key={r.n}
                  type="button"
                  aria-pressed={on}
                  aria-label={r.aria}
                  onClick={() => {
                    setRange(r.n);
                    setHoverIdx(null);
                  }}
                  className="inline-flex h-7 min-w-11 cursor-pointer items-center justify-center rounded-md border-0 px-2.5 text-xs font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] max-[641px]:h-9"
                  style={{
                    background: on ? "#FFFFFF" : "transparent",
                    color: on ? "#111827" : "#4B5563",
                    boxShadow: on ? "0 1px 2px #11182714" : "none",
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {chart}

      {ready && !visReady ? (
        <Placeholder
          icon={
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3v18h18" />
              <path d="m7 15 4-4 3 3 5-6" />
            </svg>
          }
          title="No visitor data yet"
          body={`Visitors appear here a few minutes after the Routely pixel starts sending data from ${domain}.`}
        >
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onSetUpPixel}
            className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-[13px] font-medium text-[#374151] outline-none hover:bg-[#F9FAFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
          >
            Set up pixel
          </button>
        </Placeholder>
      ) : null}

      {state === "loading" ? (
        <div aria-hidden className="flex min-h-[224px] flex-col gap-2">
          <div className={cn(skel, "flex-auto rounded-lg bg-[#F3F4F6]")} />
          <div className="flex justify-between pl-10">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cn(skel, "h-2.5 w-10 rounded-[5px] bg-[#EEF0F3]")} />
            ))}
          </div>
        </div>
      ) : null}

      {state === "error" ? <ChartError /> : null}
    </section>
  );
}
