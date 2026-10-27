"use client";

import type { MouseEvent } from "react";
import Link from "next/link";

import { ArrowRightIcon, CheckIcon } from "@/components/rt/icons";
import { percentAxis } from "@/lib/chart-axis";
import { routes } from "@/lib/routes";
import { analyzeResults, rowVerdict, wizardVerdict } from "@/lib/verdict";
import {
  ACCENT,
  DATASETS,
  MIN_CONVERSIONS,
  MIN_VISITORS,
  colorOf,
  fmt,
  shortUrl,
  type AbState,
} from "@/lib/mock/ab-test";

import { ChartIcon, ClockIcon, TrendUpIcon } from "./icons";
import type { Derived } from "./model";
import { cls, Swatch } from "./ui";
import { cn } from "@/lib/utils";

const ZERO = { v: 0, c: 0 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Your experiment is live" — shown once after a successful launch. */
export function Success({
  d,
  liveBody,
  onViewResults,
}: {
  d: Derived;
  liveBody: string;
  onViewResults(): void;
}) {
  return (
    <section aria-labelledby="rt-live-title" className="flex justify-center">
      <div className="flex w-full max-w-[640px] flex-col items-center gap-5 rounded-2xl border border-[#E5E7EB] bg-white px-8 py-10 text-center">
        <span
          aria-hidden
          className="inline-flex size-14 items-center justify-center rounded-full bg-[#DCFCE7] text-[#166534]"
        >
          <CheckIcon size={28} strokeWidth={2.4} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2
            id="rt-live-title"
            className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.01em] text-[#111827]"
          >
            Your experiment is live
          </h2>
          <p className="m-0 text-[14px] leading-[22px] text-pretty text-[#4B5563]">{liveBody}</p>
        </div>
        <div className="flex w-full flex-col gap-2.5 rounded-xl border border-[#EEF0F3] bg-[#FAFBFC] p-4 text-left">
          {d.rv.arms.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 text-[14px]"
            >
              <Swatch color={a.color} size={10} radius={3} />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-[#374151]">{a.name}</span>
                <span className="text-[13px] text-[#6B7280]">{a.meta}</span>
              </span>
              <span className="font-semibold text-[#111827] tabular-nums">{a.pct}</span>
            </div>
          ))}
          <div className="h-px bg-[#F3F4F6]" />
          <span className="text-[13px] text-[#4B5563]">Goal: Page view · {d.rv.goalUrl}</span>
        </div>
        <div className="flex w-full flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={onViewResults}
            className={cn(cls.primary, "px-[18px]", cls.tall)}
            style={{ background: ACCENT }}
          >
            View results
            <ArrowRightIcon />
          </button>
          <Link href={routes.experiments.list} className={cn(cls.secondary, "px-[18px]", cls.tall)}>
            Back to experiments
          </Link>
        </div>
      </div>
    </section>
  );
}

const GRID =
  "grid grid-cols-[minmax(180px,2fr)_96px_100px_100px_96px_110px_170px] gap-x-3 items-center max-[1321px]:grid-cols-[minmax(180px,2fr)_96px_100px_96px_110px_170px] max-[961px]:grid-cols-[repeat(3,minmax(0,1fr))] max-[961px]:[grid-template-areas:'ver_ver_ver'_'vis_conv_rate'_'lift_chance_chance'] max-[961px]:gap-y-3 max-[961px]:!p-4 max-[961px]:items-start";
const SHARE = "max-[1321px]:hidden";
const MLABEL = "hidden max-[961px]:block text-[12px] font-normal text-[#6B7280]";

/**
 * The live experiment: verdict, totals, per-version comparison, cumulative conversion-rate chart
 * and details. `s.data` picks the seed — none (just launched), early (3 days) or mature (14).
 */
export function Results({
  s,
  d,
  onHover,
  onPreview,
}: {
  s: AbState;
  d: Derived;
  onHover(i: number | null): void;
  onPreview(id: string): void;
}) {
  const { arms, f } = { arms: d.arms, f: s.form };
  const ds = s.data !== "none" ? DATASETS[s.data] : null;
  const data = arms.map((_, i) => (ds ? (ds.rows[i] ?? ZERO) : ZERO));
  const at = (i: number) => data[i] ?? ZERO;
  const hasData = !!ds;
  const armAt = (i: number) => arms[i] ?? arms[0]!;
  // Every chance, pill and verdict from lib/verdict.ts (the gate, the Bayesian chance, the
  // multi-variant winner rule) — the seeded data is only the counts.
  const analysis = analyzeResults(
    arms.map((a, i) => ({ name: a.name, visitors: at(i).v, conversions: at(i).c })),
  );
  const enough = analysis.enough;
  const totV = data.reduce((x, r) => x + r.v, 0);
  const totC = data.reduce((x, r) => x + r.c, 0);
  const base = at(0);
  const baseRate = base.v ? base.c / base.v : 0;
  const rows = arms.map((a, i) => {
    const r = at(i);
    const rate = r.v ? r.c / r.v : null;
    const isC = i === 0;
    const lift = !isC && rate != null && baseRate ? rate / baseRate - 1 : null;
    const chance = enough && !isC ? (analysis.arms[i]?.chance ?? null) : null;
    const verdict = rowVerdict(analysis.arms[i]!, analysis);
    return {
      id: a.id,
      name: a.name,
      meta: d.metaOf(a),
      color: colorOf(a),
      isC,
      visitors: fmt(r.v),
      share: totV ? ((r.v / totV) * 100).toFixed(1) + "%" : "—",
      conv: fmt(r.c),
      rate: rate != null ? (rate * 100).toFixed(2) + "%" : "—",
      lift: isC
        ? "Baseline"
        : lift == null
          ? "—"
          : (lift >= 0 ? "+" : "−") + Math.abs(lift * 100).toFixed(1) + "%",
      liftFg: isC || lift == null || !enough ? "#6B7280" : lift >= 0 ? "#166534" : "#B91C1C",
      chance: isC ? "—" : chance == null ? "—" : (chance * 100).toFixed(1) + "%",
      chanceNum: chance,
      liftNum: lift ?? 0,
      verdict,
      verdictBg:
        verdict === "Likely better"
          ? "#DCFCE7"
          : verdict === "Likely worse"
            ? "#FEF2F2"
            : "#F3F4F6",
      verdictFg:
        verdict === "Likely better"
          ? "#166534"
          : verdict === "Likely worse"
            ? "#B91C1C"
            : "#4B5563",
    };
  });
  const wv = wizardVerdict(analysis, "ab");
  const significant = wv.kind === "win";
  const vTitle = wv.title;
  const vBody = wv.body;

  // Seeded jitter around each arm's final rate, damped as days accumulate — the reference's curve.
  const DAYS = ds ? ds.days : 14;
  const series = arms.map((_, i) => {
    let seed = 131 + i * 37;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const R = at(i).v ? at(i).c / at(i).v : 0;
    const out: number[] = [];
    for (let dd = 1; dd <= DAYS; dd++)
      out.push(R * (1 + (dd === DAYS ? 0 : ((rnd() - 0.5) * 0.9) / Math.sqrt(dd))));
    return out;
  });
  let maxR = 0;
  series.forEach((sr) => sr.forEach((r) => (maxR = Math.max(maxR, r))));
  const { maxPct: yMaxPct, ticks } = percentAxis(maxR);
  const X = (i: number) => (DAYS > 1 ? (i / (DAYS - 1)) * 1000 : 500);
  const Y = (r: number) => 200 - ((r * 100) / yMaxPct) * 200;
  const dateOf = (i: number) => {
    const st0 = ds ? ds.start : [2026, 9, 13];
    const dt = new Date(st0[0], st0[1], st0[2] + i);
    return MONTHS[dt.getMonth()] + " " + dt.getDate();
  };
  const hi = s.hoverIdx;
  const hasHover = hasData && hi != null && hi >= 0 && hi < DAYS;
  const hIdx = hasHover ? hi! : DAYS - 1;
  const yTicks: { label: string; bottom: string; line: string }[] = [];
  for (const yt of ticks)
    yTicks.push({
      label: yt + "%",
      bottom: ((yt / yMaxPct) * 100).toFixed(2) + "%",
      line: yt === 0 ? "#D1D5DB" : "#F3F4F6",
    });
  const xIdx =
    DAYS <= 4
      ? Array.from({ length: DAYS }, (_, i) => i)
      : [0, Math.round((DAYS - 1) / 3), Math.round((2 * (DAYS - 1)) / 3), DAYS - 1];
  const hx = (X(hIdx) / 10).toFixed(2) + "%";
  const chartAria =
    "Line chart of cumulative conversion rate by version over " +
    DAYS +
    " days. " +
    rows.map((r) => r.name + " ends at " + r.rate).join(", ") +
    ".";
  const plotMove = (ev: MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const fr = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    onHover(Math.round(fr * (DAYS - 1)));
  };

  const dist = arms.map((a, i) => {
    const pc = hasData ? (totV ? (at(i).v / totV) * 100 : 0) : d.pctOf(a);
    return {
      id: a.id,
      name: a.name,
      color: colorOf(a),
      width: pc.toFixed(2) + "%",
      label: hasData ? pc.toFixed(1) + "%" : pc + "%",
    };
  });
  const goal = shortUrl(f.goalUrl) || "goal page";
  const tiles = [
    { label: "Visitors", value: fmt(totV), sub: "Across all versions" },
    { label: "Goal page views", value: fmt(totC), sub: "Page view · " + goal },
    {
      label: "Conversion rate",
      value: totV ? ((totC / totV) * 100).toFixed(2) + "%" : "—",
      sub: "All versions combined",
    },
  ];
  const vFg = significant ? "#166534" : "#4B5563";
  const vBorder = significant ? "#BBF7D0" : "#E5E7EB";

  return (
    <>
      <div
        className="flex flex-col gap-3.5 rounded-xl border px-[18px] py-4"
        style={{ borderColor: vBorder, background: significant ? "#ECFDF5" : "#FFFFFF" }}
      >
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden
            className="inline-flex size-9 flex-none items-center justify-center rounded-full border bg-white"
            style={{ color: vFg, borderColor: vBorder }}
          >
            {significant ? <TrendUpIcon /> : <ClockIcon />}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-[#111827]">{vTitle}</span>
            <span className="text-[14px] leading-5 text-pretty text-[#374151]">{vBody}</span>
          </div>
        </div>
        {hasData && !enough ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3 pl-[50px]">
            {arms.map((a, i) => (
              <div
                key={a.id}
                className="flex flex-col gap-1.5 rounded-lg border border-[#EEF0F3] bg-white px-3 py-2.5"
              >
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#374151]">
                  <Swatch color={colorOf(a)} />
                  {a.name}
                </span>
                <Progress
                  label="Visitors"
                  value={fmt(at(i).v) + " / " + fmt(MIN_VISITORS)}
                  pct={(at(i).v / MIN_VISITORS) * 100}
                  color={colorOf(a)}
                />
                <Progress
                  label="Goal page views"
                  value={at(i).c + " / " + MIN_CONVERSIONS}
                  pct={(at(i).c / MIN_CONVERSIONS) * 100}
                  color={colorOf(a)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
        {tiles.map((tl) => (
          <div
            key={tl.label}
            className="flex flex-col gap-1 rounded-xl border border-[#EEF0F3] bg-white px-5 py-[18px]"
          >
            <span className="text-[13px] text-[#6B7280]">{tl.label}</span>
            <span className="text-[26px] leading-[30px] font-semibold tracking-[-0.02em] text-[#111827]">
              {tl.value}
            </span>
            <span className="text-[13px] text-[#6B7280]">{tl.sub}</span>
          </div>
        ))}
      </div>

      <section
        aria-labelledby="rt-cmp-title"
        className="rounded-xl border border-[#EEF0F3] bg-white"
      >
        <div className="flex flex-col gap-3.5 p-5 max-[641px]:px-4">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="flex flex-col gap-0.5">
              <h2
                id="rt-cmp-title"
                className="m-0 text-[16px] leading-6 font-semibold text-[#111827]"
              >
                Version comparison
              </h2>
              <p className="m-0 text-[13px] text-[#6B7280]">Goal: Page view · {goal}</p>
            </div>
            <span className="text-[13px] text-[#6B7280]">
              {hasData ? "Actual traffic split" : "Configured traffic split"}
            </span>
          </div>
          <div aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-[#F3F4F6]">
            {dist.map((b) => (
              <span
                key={b.id}
                className="block h-full flex-none"
                style={{ width: b.width, background: b.color }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-[18px] gap-y-1.5">
            {dist.map((b) => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1.5 text-[13px] text-[#374151]"
              >
                <Swatch color={b.color} />
                {b.name}{" "}
                <strong className="font-semibold text-[#111827] tabular-nums">{b.label}</strong>
              </span>
            ))}
          </div>
        </div>
        <div role="table" aria-label="Version comparison">
          <div role="rowgroup" className="max-[961px]:hidden">
            <div
              role="row"
              className={cn(
                GRID,
                "min-h-10 border-t border-[#EEF0F3] bg-[#FAFBFC] px-5 py-1.5 text-[12px] font-medium text-[#6B7280]",
              )}
            >
              <span role="columnheader">Version</span>
              <span role="columnheader">Visitors</span>
              <span role="columnheader" className={SHARE}>
                Traffic share
              </span>
              <span role="columnheader">Page views</span>
              <span role="columnheader">Conv. rate</span>
              <span role="columnheader">vs. Control</span>
              <span role="columnheader">Chance to beat Control</span>
            </div>
          </div>
          <div role="rowgroup">
            {rows.map((rr) => (
              <div
                key={rr.id}
                role="row"
                className={cn(GRID, "min-h-16 border-t border-[#EEF0F3] px-5 py-3")}
              >
                <div
                  role="cell"
                  className="flex min-w-0 flex-col gap-0.5 max-[961px]:[grid-area:ver]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Swatch color={rr.color} radius={999} />
                      <span className="truncate text-[14px] font-semibold text-[#111827]">
                        {rr.name}
                      </span>
                    </span>
                    {rr.isC ? (
                      <span className="inline-flex h-6 items-center rounded-md bg-[#F3F4F6] px-2 text-[12px] font-semibold text-[#4B5563]">
                        Baseline
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[13px] text-[#6B7280]">{rr.meta}</span>
                </div>
                <Cell area="vis" label="Visitors" value={rr.visitors} />
                <div
                  role="cell"
                  className={cn(
                    SHARE,
                    "text-[14px] text-[#374151] tabular-nums max-[961px]:hidden",
                  )}
                >
                  {rr.share}
                </div>
                <Cell area="conv" label="Page views" value={rr.conv} />
                <Cell area="rate" label="Conv. rate" value={rr.rate} />
                <Cell area="lift" label="vs. Control" value={rr.lift} color={rr.liftFg} />
                <div
                  role="cell"
                  className="flex min-w-0 flex-col gap-1 max-[961px]:[grid-area:chance]"
                >
                  <span className={MLABEL}>Chance to beat Control</span>
                  <span className="text-[14px] font-semibold text-[#111827] tabular-nums">
                    {rr.chance}
                  </span>
                  {rr.verdict ? (
                    <span
                      className="inline-flex h-6 items-center self-start rounded-md px-2 text-[12px] font-semibold whitespace-nowrap"
                      style={{ background: rr.verdictBg, color: rr.verdictFg }}
                    >
                      {rr.verdict}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby="rt-chart-title"
          className="flex min-w-0 flex-[2_1_520px] flex-col gap-4 rounded-xl border border-[#EEF0F3] bg-white p-5"
        >
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="flex flex-col gap-0.5">
              <h2
                id="rt-chart-title"
                className="m-0 text-[16px] leading-6 font-semibold text-[#111827]"
              >
                Conversion rate over time
              </h2>
              <p className="m-0 text-[13px] text-[#6B7280]">
                Cumulative goal page views per visitor, by version
              </p>
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
              {arms.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 text-[13px] text-[#374151]"
                >
                  <span
                    aria-hidden
                    className="h-0.5 w-3 rounded-sm"
                    style={{ background: colorOf(a) }}
                  />
                  {a.name}
                </span>
              ))}
            </div>
          </div>
          {hasData ? (
            <div className="flex flex-col gap-2">
              <div className="flex h-[220px]">
                <div aria-hidden className="relative w-10 flex-[0_0_40px]">
                  {yTicks.map((t) => (
                    <span
                      key={t.label}
                      className="absolute right-2.5 translate-y-1/2 text-[12px] leading-[14px] text-[#6B7280] tabular-nums"
                      style={{ bottom: t.bottom }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
                <div
                  role="img"
                  aria-label={chartAria}
                  onMouseMove={plotMove}
                  onClick={plotMove}
                  onMouseLeave={() => onHover(null)}
                  className="relative min-w-0 flex-auto cursor-crosshair"
                >
                  {yTicks.map((t) => (
                    <div
                      key={t.label}
                      aria-hidden
                      className="absolute right-0 left-0 h-px"
                      style={{ bottom: t.bottom, background: t.line }}
                    />
                  ))}
                  <svg
                    aria-hidden
                    viewBox="0 0 1000 200"
                    preserveAspectRatio="none"
                    className="absolute top-0 left-0 size-full overflow-visible"
                  >
                    {series.map((sr, i) => (
                      <path
                        key={armAt(i).id}
                        d={sr
                          .map((r, j) => (j ? "L" : "M") + X(j).toFixed(1) + " " + Y(r).toFixed(1))
                          .join(" ")}
                        fill="none"
                        stroke={colorOf(armAt(i))}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                  {hasHover ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#9CA3AF]"
                      style={{ left: hx }}
                    />
                  ) : null}
                  {series.map((sr, i) => (
                    <div
                      key={armAt(i).id}
                      aria-hidden
                      className="pointer-events-none absolute size-[9px] -translate-x-1/2 translate-y-1/2 rounded-full shadow-[0_0_0_2px_#FFFFFF]"
                      style={{
                        left: hx,
                        bottom: ((((sr[hIdx] ?? 0) * 100) / yMaxPct) * 100).toFixed(2) + "%",
                        background: colorOf(armAt(i)),
                      }}
                    />
                  ))}
                  {hasHover ? (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute top-1 z-[3] flex min-w-[150px] flex-col gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-2 whitespace-nowrap text-[#111827] shadow-[0_8px_24px_#1118271F,0_1px_3px_#1118270F]"
                      style={{
                        left: hx,
                        transform:
                          X(hIdx) > 600 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
                      }}
                    >
                      <span className="text-[12px] leading-4 text-[#6B7280]">
                        {dateOf(hIdx) + " · day " + (hIdx + 1)}
                      </span>
                      {series.map((sr, i) => (
                        <span
                          key={armAt(i).id}
                          className="flex items-center justify-between gap-3 text-[13px] leading-[17px]"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="size-2 rounded-xs"
                              style={{ background: colorOf(armAt(i)) }}
                            />
                            {armAt(i).name}
                          </span>
                          <strong className="font-semibold tabular-nums">
                            {((sr[hIdx] ?? 0) * 100).toFixed(2) + "%"}
                          </strong>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div aria-hidden className="relative ml-10 h-4">
                {xIdx.map((i) => (
                  <span
                    key={i}
                    className="absolute top-0 text-[12px] leading-4 whitespace-nowrap text-[#6B7280]"
                    style={{
                      left: (X(i) / 10).toFixed(2) + "%",
                      transform:
                        i === 0
                          ? "translateX(0)"
                          : i === DAYS - 1
                            ? "translateX(-100%)"
                            : "translateX(-50%)",
                    }}
                  >
                    {dateOf(i)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[244px] flex-col items-center justify-center gap-2.5 rounded-lg bg-[#F9FAFB] p-4 text-center">
              <span
                aria-hidden
                className="inline-flex size-10 items-center justify-center rounded-full bg-[#F3F4F6] text-[#4B5563]"
              >
                <ChartIcon />
              </span>
              <p className="m-0 text-[14px] font-semibold text-[#111827]">
                Waiting for the first visitors
              </p>
              <p className="m-0 max-w-[340px] text-[13px] leading-[19px] text-[#4B5563]">
                This chart fills in as visitors see your versions and reach the goal page.
              </p>
            </div>
          )}
        </section>

        <section
          aria-labelledby="rt-det-title"
          className="flex min-w-0 flex-[1_1_300px] flex-col rounded-xl border border-[#EEF0F3] bg-white"
        >
          <div className="border-b border-[#EEF0F3] px-[18px] py-4">
            <h2
              id="rt-det-title"
              className="m-0 text-[16px] leading-6 font-semibold text-[#111827]"
            >
              Experiment details
            </h2>
          </div>
          <div className="flex flex-col gap-1 border-b border-[#EEF0F3] px-[18px] py-3.5">
            <span className={cls.eyebrow}>Page</span>
            <span className="text-[13px] [overflow-wrap:anywhere] text-[#374151]">{d.rv.page}</span>
          </div>
          <div className="flex flex-col gap-2.5 border-b border-[#EEF0F3] px-[18px] py-3.5">
            <span className={cls.eyebrow}>Versions</span>
            {d.rv.arms.map((a) => (
              <div key={a.id} className="flex min-w-0 items-center justify-between gap-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Swatch color={a.color} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-semibold text-[#374151]">{a.name}</span>
                    <span className="text-[13px] text-[#6B7280]">{a.meta}</span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onPreview(a.id)}
                  aria-label={"Preview " + a.name}
                  className={cn(cls.secondary, "h-[30px] flex-none px-2.5 text-[12px]")}
                >
                  Preview
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 px-[18px] py-3.5">
            <Detail k="Goal" v={"Page view · " + d.rv.goalUrl} wrap />
            <Detail k="Visitors included" v={d.rv.includeShort} />
            <Detail k="Targeting" v={d.rv.targeting} />
          </div>
        </section>
      </div>
    </>
  );
}

function Progress({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="flex justify-between gap-2 text-[12px] text-[#6B7280]">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </span>
      <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-[#F3F4F6]">
        <span
          className="block h-full"
          style={{ width: Math.min(100, pct).toFixed(1) + "%", background: color }}
        />
      </span>
    </div>
  );
}

// Static strings so Tailwind generates each stacked-layout area.
const AREA = {
  vis: "max-[961px]:[grid-area:vis]",
  conv: "max-[961px]:[grid-area:conv]",
  rate: "max-[961px]:[grid-area:rate]",
  lift: "max-[961px]:[grid-area:lift]",
};

function Cell({
  area,
  label,
  value,
  color = "#111827",
}: {
  area: keyof typeof AREA;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      role="cell"
      className={cn("text-[14px] font-semibold tabular-nums", AREA[area])}
      style={{ color }}
    >
      <span className={MLABEL}>{label}</span>
      {value}
    </div>
  );
}

function Detail({ k, v, wrap = false }: { k: string; v: string; wrap?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-[#6B7280]">{k}</span>
      <span
        className={cn(
          "text-right font-medium text-[#374151]",
          wrap ? "[overflow-wrap:anywhere]" : "",
        )}
      >
        {v}
      </span>
    </div>
  );
}
