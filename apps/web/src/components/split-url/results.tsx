"use client";

import type { MouseEvent } from "react";
import Link from "next/link";

import { ArrowRightIcon, CheckIcon } from "@/components/rt/icons";
import { percentAxis } from "@/lib/chart-axis";
import {
  ACCENT_INK,
  ACCENT_TINT,
  RESULT_DATA,
  RESULT_DAYS,
  colorOf,
  fmt,
  phi,
  shortUrl,
  type SplitState,
} from "@/lib/mock/split-url";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { Detail } from "./dialogs";
import type { Derived } from "./model";
import { ChartIcon, Chip, ClockIcon, Swatch, TrendUpIcon, cls } from "./ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Your experiment is live" — shown once the launch completes. */
export function Success({
  s,
  d,
  onViewResults,
}: {
  s: SplitState;
  d: Derived;
  onViewResults(): void;
}) {
  return (
    <section aria-labelledby="rt-live-title" className="flex justify-center">
      <div className="flex w-full max-w-[640px] flex-col items-center gap-5 rounded-[16px] border border-[#E5E7EB] bg-white px-8 py-10 text-center">
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
          <p className="m-0 text-[14px] leading-[22px] text-pretty text-[#4B5563]">
            {"Visitors to " +
              (shortUrl(s.form.controlUrl) || "your Control page") +
              " are now split between " +
              d.arms.length +
              " versions. Results usually start appearing within a few minutes."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2.5 rounded-[12px] border border-[#EEF0F3] bg-[#FAFBFC] p-4 text-left">
          {d.rvArms.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 text-[14px]"
            >
              <Swatch color={a.color} size={10} radius={3} />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-[#374151]">{a.name}</span>
                <span className="truncate text-[13px] text-[#6B7280]">{a.url}</span>
              </span>
              <span className="font-semibold text-[#111827] tabular-nums">{a.pct}</span>
            </div>
          ))}
          <div className="h-px bg-[#F3F4F6]" />
          <span className="text-[13px] text-[#4B5563]">Page visit · {d.goalUrlText}</span>
        </div>
        <div className="flex w-full flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={onViewResults}
            className={cn(cls.primary, cls.tall, "px-[18px]")}
          >
            View results
            <ArrowRightIcon />
          </button>
          <Link href={routes.experiments.list} className={cn(cls.secondary, cls.tall, "px-[18px]")}>
            Back to experiments
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Version-comparison grid: collapses to stacked cards at 960px and drops Traffic share at 1320px. */
const rgrid =
  "grid grid-cols-[minmax(180px,2fr)_96px_100px_100px_96px_110px_170px] items-center gap-x-3 px-5 max-[1321px]:grid-cols-[minmax(180px,2fr)_96px_100px_96px_110px_170px] max-[961px]:grid-cols-3 max-[961px]:items-start max-[961px]:gap-y-3 max-[961px]:p-4";
const mlabel = "hidden text-[12px] font-normal text-[#6B7280] max-[961px]:block";
const shareCol = "max-[1321px]:hidden";

/** The live experiment: verdict, totals, version comparison, chart and details. */
export function Results({
  s,
  d,
  onHover,
}: {
  s: SplitState;
  d: Derived;
  onHover(i: number | null): void;
}) {
  const f = s.form;
  const arms = d.arms;
  const hasData = s.hasData;
  const ZERO = { v: 0, c: 0 };
  const data = arms.map((_, i) => (hasData ? (RESULT_DATA[i] ?? ZERO) : ZERO));
  const at = (i: number) => data[i] ?? ZERO;
  const totV = data.reduce((x, r) => x + r.v, 0);
  const totC = data.reduce((x, r) => x + r.c, 0);
  const base = at(0);
  const baseRate = base.v ? base.c / base.v : 0;
  const rows = arms.map((a, i) => {
    const r = at(i);
    const rate = r.v ? r.c / r.v : null;
    const isC = i === 0;
    const lift = !isC && rate != null && baseRate ? rate / baseRate - 1 : null;
    let chance: number | null = null;
    if (!isC && r.v && base.v && rate != null) {
      const se = Math.sqrt((baseRate * (1 - baseRate)) / base.v + (rate * (1 - rate)) / r.v);
      chance = se ? phi((rate - baseRate) / se) : 0.5;
    }
    const verdict =
      chance == null
        ? ""
        : chance >= 0.95
          ? "Likely better"
          : chance <= 0.05
            ? "Likely worse"
            : "Not significant yet";
    return {
      id: a.id,
      rawChance: chance,
      rawLift: lift,
      name: a.name.trim() || "Unnamed variant",
      url: shortUrl(a.url),
      color: colorOf(a),
      isControl: isC,
      visitors: fmt(r.v),
      share: totV ? ((r.v / totV) * 100).toFixed(1) + "%" : "—",
      conv: fmt(r.c),
      rate: rate != null ? (rate * 100).toFixed(2) + "%" : "—",
      lift: isC
        ? "Baseline"
        : lift == null
          ? "—"
          : (lift >= 0 ? "+" : "−") + Math.abs(lift * 100).toFixed(1) + "%",
      liftFg: isC || lift == null ? "#6B7280" : lift >= 0 ? "#166534" : "#B91C1C",
      chance: isC ? "—" : chance == null ? "—" : (chance * 100).toFixed(1) + "%",
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
  // The variant most likely to beat Control (first wins a tie, as in the reference).
  let top: { name: string; chance: number; lift: number | null } | null = null;
  for (const r of rows)
    if (r.rawChance != null && (!top || r.rawChance > top.chance))
      top = {
        name: r.name === "Unnamed variant" ? "Variant" : r.name,
        chance: r.rawChance,
        lift: r.rawLift,
      };
  const significant = !!top && top.chance >= 0.95;
  const others = rows.filter((r, i) => i > 0 && r.name !== (top && top.name));
  const verdictBody =
    significant && top
      ? top.name +
        " is converting " +
        Math.abs((top.lift || 0) * 100).toFixed(1) +
        "% better than Control, with a " +
        (top.chance * 100).toFixed(1) +
        "% chance to beat it." +
        (others.length
          ? " " +
            others.map((o) => o.name).join(" and ") +
            (others.length === 1 ? " isn’t" : " aren’t") +
            " significantly different yet."
          : "")
      : "None of the variants is clearly better or worse than Control yet. Keep the experiment running to collect more data.";
  const dist = arms.map((a, i) => {
    const pct = hasData ? (totV ? (at(i).v / totV) * 100 : 0) : d.pct(a.id);
    return {
      id: a.id,
      name: a.name.trim() || "Variant",
      color: colorOf(a),
      width: pct.toFixed(2) + "%",
      label: hasData ? pct.toFixed(1) + "%" : pct + "%",
    };
  });

  // Seeded noise that settles on each arm's final rate: a cumulative rate steadies as data grows.
  const DAYS = RESULT_DAYS;
  const series = arms.map((_, i) => {
    let seed = 97 + i * 31;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const R = at(i).v ? at(i).c / at(i).v : 0;
    const out: number[] = [];
    for (let dd = 1; dd <= DAYS; dd++) {
      const noise = dd === DAYS ? 0 : ((rnd() - 0.5) * 0.9) / Math.sqrt(dd);
      out.push(R * (1 + noise));
    }
    return out;
  });
  let maxR = 0;
  series.forEach((sr) => sr.forEach((r) => (maxR = Math.max(maxR, r))));
  const { maxPct: yMaxPct, ticks } = percentAxis(maxR);
  const X = (i: number) => (i / (DAYS - 1)) * 1000;
  const Y = (r: number) => 200 - ((r * 100) / yMaxPct) * 200;
  const dateOf = (i: number) => {
    const dt = new Date(2026, 8, 29 + i);
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

  const tiles = [
    {
      label: "Visitors",
      value: fmt(totV),
      sub: hasData ? "Across all versions since Sep 29" : "Across all versions",
    },
    { label: "Conversions", value: fmt(totC), sub: "Page visit" },
    {
      label: "Conversion rate",
      value: totV ? ((totC / totV) * 100).toFixed(2) + "%" : "—",
      sub: "All versions combined",
    },
  ];
  const vFg = significant ? "#166534" : "#4B5563";
  const vBorder = significant ? "#BBF7D0" : "#E5E7EB";
  const eyebrow = "text-[11px] font-semibold tracking-[0.04em] text-[#6B7280] uppercase";

  return (
    <>
      {hasData ? (
        <div
          className="flex items-start gap-3.5 rounded-[12px] border px-[18px] py-4"
          style={{ borderColor: vBorder, background: significant ? "#ECFDF5" : "#FFFFFF" }}
        >
          <span
            aria-hidden
            className="inline-flex size-9 flex-none items-center justify-center rounded-full border bg-white"
            style={{ color: vFg, borderColor: vBorder }}
          >
            <TrendUpIcon />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-[#111827]">
              {significant && top
                ? top.name + " is likely better than Control"
                : "No clear winner yet"}
            </span>
            <span className="text-[14px] leading-5 text-pretty text-[#374151]">{verdictBody}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3.5 rounded-[12px] border border-[#EEF0F3] bg-white px-[18px] py-4">
          <span
            aria-hidden
            className="inline-flex size-9 flex-none items-center justify-center rounded-full"
            style={{ background: ACCENT_TINT, color: ACCENT_INK }}
          >
            <ClockIcon />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-[#111827]">Collecting data</span>
            <span className="text-[14px] leading-5 text-pretty text-[#374151]">
              Results appear here once visitors reach your Control page. This usually takes a few
              minutes after launch. Avoid judging a winner until each version has a meaningful
              number of conversions.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="flex flex-col gap-1 rounded-[12px] border border-[#EEF0F3] bg-white px-5 py-[18px]"
          >
            <span className="text-[13px] text-[#6B7280]">{t.label}</span>
            <span className="text-[26px] leading-[30px] font-semibold tracking-[-0.02em] text-[#111827]">
              {t.value}
            </span>
            <span className="text-[13px] text-[#6B7280]">{t.sub}</span>
          </div>
        ))}
      </div>

      <section
        aria-labelledby="rt-cmp-title"
        className="rounded-[12px] border border-[#EEF0F3] bg-white"
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
              <p className="m-0 text-[13px] text-[#6B7280]">
                {"Goal: Page visit · " + (shortUrl(f.goalUrl) || "conversion page")}
              </p>
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
                rgrid,
                "min-h-10 border-t border-[#EEF0F3] bg-[#FAFBFC] py-1.5 text-[12px] font-medium text-[#6B7280]",
              )}
            >
              <span role="columnheader">Version</span>
              <span role="columnheader">Visitors</span>
              <span role="columnheader" className={shareCol}>
                Traffic share
              </span>
              <span role="columnheader">Conversions</span>
              <span role="columnheader">Conv. rate</span>
              <span role="columnheader">vs. Control</span>
              <span role="columnheader">Chance to beat Control</span>
            </div>
          </div>
          <div role="rowgroup">
            {rows.map((r) => (
              <div
                key={r.id}
                role="row"
                className={cn(rgrid, "min-h-16 border-t border-[#EEF0F3] py-3")}
              >
                <div role="cell" className="flex min-w-0 flex-col gap-0.5 max-[961px]:col-span-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Swatch color={r.color} radius={999} />
                      <span className="truncate text-[14px] font-semibold text-[#111827]">
                        {r.name}
                      </span>
                    </span>
                    {r.isControl ? <Chip>Baseline</Chip> : null}
                  </span>
                  <span className="truncate text-[13px] text-[#6B7280]">{r.url}</span>
                </div>
                <div role="cell" className="text-[14px] font-semibold text-[#111827] tabular-nums">
                  <span className={mlabel}>Visitors</span>
                  {r.visitors}
                </div>
                <div
                  role="cell"
                  className={cn(
                    shareCol,
                    "text-[14px] text-[#374151] tabular-nums max-[961px]:hidden",
                  )}
                >
                  {r.share}
                </div>
                <div role="cell" className="text-[14px] font-semibold text-[#111827] tabular-nums">
                  <span className={mlabel}>Conversions</span>
                  {r.conv}
                </div>
                <div role="cell" className="text-[14px] font-semibold text-[#111827] tabular-nums">
                  <span className={mlabel}>Conv. rate</span>
                  {r.rate}
                </div>
                <div
                  role="cell"
                  className="text-[14px] font-semibold tabular-nums"
                  style={{ color: r.liftFg }}
                >
                  <span className={mlabel}>vs. Control</span>
                  {r.lift}
                </div>
                <div role="cell" className="flex min-w-0 flex-col gap-1 max-[961px]:col-span-2">
                  <span className={cn(mlabel, "font-normal")}>Chance to beat Control</span>
                  <span className="text-[14px] font-semibold text-[#111827] tabular-nums">
                    {r.chance}
                  </span>
                  {r.verdict ? (
                    <span
                      className="inline-flex h-6 items-center self-start rounded-[6px] px-2 text-[12px] font-semibold whitespace-nowrap"
                      style={{ background: r.verdictBg, color: r.verdictFg }}
                    >
                      {r.verdict}
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
          className="flex min-w-0 flex-[2_1_520px] flex-col gap-4 rounded-[12px] border border-[#EEF0F3] bg-white p-5"
        >
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="flex flex-col gap-0.5">
              <h2
                id="rt-chart-title"
                className="m-0 text-[16px] leading-6 font-semibold text-[#111827]"
              >
                Conversion rate over time
              </h2>
              <p className="m-0 text-[13px] text-[#6B7280]">Cumulative, by version</p>
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
              {arms.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 text-[13px] text-[#374151]"
                >
                  <span
                    aria-hidden
                    className="h-0.5 w-3 rounded-[2px]"
                    style={{ background: colorOf(a) }}
                  />
                  {a.name.trim() || "Variant"}
                </span>
              ))}
            </div>
          </div>
          {hasData ? (
            <div className="flex flex-col gap-2">
              <div className="flex h-[220px]">
                <div aria-hidden className="relative w-10 flex-none">
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
                        key={i}
                        d={sr
                          .map((r, j) => (j ? "L" : "M") + X(j).toFixed(1) + " " + Y(r).toFixed(1))
                          .join(" ")}
                        fill="none"
                        stroke={colorOf(arms[i] ?? arms[0]!)}
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
                      key={i}
                      aria-hidden
                      className="pointer-events-none absolute size-[9px] -translate-x-1/2 translate-y-1/2 rounded-full shadow-[0_0_0_2px_#FFFFFF]"
                      style={{
                        left: hx,
                        bottom: ((((sr[hIdx] ?? 0) * 100) / yMaxPct) * 100).toFixed(2) + "%",
                        background: colorOf(arms[i] ?? arms[0]!),
                      }}
                    />
                  ))}
                  {hasHover ? (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute top-1 z-[3] flex min-w-[150px] flex-col gap-1 rounded-[8px] border border-[#E5E7EB] bg-white px-2.5 py-2 whitespace-nowrap text-[#111827] shadow-[0_8px_24px_#1118271F,0_1px_3px_#1118270F]"
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
                          key={i}
                          className="flex items-center justify-between gap-3 text-[13px] leading-[17px]"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Swatch color={colorOf(arms[i] ?? arms[0]!)} />
                            {arms[i]?.name.trim() || "Variant"}
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
                {[0, 4, 8, 12, 14].map((i) => (
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
            <div className="flex min-h-[244px] flex-col items-center justify-center gap-2.5 rounded-[8px] bg-[#F9FAFB] p-4 text-center">
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
                This chart fills in as visitors are split between your versions and reach the
                conversion page.
              </p>
            </div>
          )}
        </section>

        <section
          aria-labelledby="rt-det-title"
          className="flex min-w-0 flex-[1_1_300px] flex-col rounded-[12px] border border-[#EEF0F3] bg-white"
        >
          <div className="border-b border-[#EEF0F3] px-[18px] py-4">
            <h2
              id="rt-det-title"
              className="m-0 text-[16px] leading-6 font-semibold text-[#111827]"
            >
              Experiment details
            </h2>
          </div>
          <div className="flex flex-col gap-2.5 border-b border-[#EEF0F3] px-[18px] py-3.5">
            <span className={eyebrow}>Pages</span>
            {d.rvArms.map((a) => (
              <div key={a.id} className="flex min-w-0 items-start gap-2">
                <Swatch color={a.color} className="mt-1.5" />
                <span className="flex min-w-0 flex-auto flex-col">
                  <span className="text-[13px] font-semibold text-[#374151]">{a.name}</span>
                  <a
                    href={a.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[13px] text-[#4B5563] no-underline hover:text-[#111827]"
                  >
                    {a.url}
                  </a>
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1 border-b border-[#EEF0F3] px-[18px] py-3.5">
            <span className={eyebrow}>Conversion goal</span>
            <span className="text-[13px] text-[#374151]">Page visit</span>
            <span className="truncate text-[13px] text-[#4B5563]">{d.goalUrlText}</span>
          </div>
          <div className="flex flex-col gap-2 px-[18px] py-3.5">
            <Detail label="Visitors included" value={d.includeShort} />
            <Detail label="Targeting" value={d.targetText} />
            <Detail label="URL parameters" value={f.keepParams ? "Kept" : "Dropped"} />
          </div>
        </section>
      </div>
    </>
  );
}
