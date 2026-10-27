"use client";

import { useState, type MouseEvent } from "react";

import { ChartIcon } from "@/components/experiments-list/experiment-type-icons";
import { Svg } from "@/components/rt/icons";
import { type ResultsModel, chartHover } from "@/lib/experiment-model";
import { cn } from "@/lib/utils";

export const CARD = "flex min-w-0 flex-col rounded-xl border border-[#EEF0F3] bg-white";
export const H2 = "m-0 text-base leading-6 font-semibold text-[#111827]";
export const CAPTION = "m-0 text-[13px] leading-[19px] text-[#6B7280]";
const VGRID =
  "grid grid-cols-[minmax(200px,2.2fr)_minmax(84px,.8fr)_minmax(72px,.7fr)_minmax(96px,.8fr)_minmax(96px,.8fr)_minmax(90px,.8fr)_minmax(130px,1fr)] items-center gap-x-3";
const MLABEL = "hidden text-left text-xs text-[#6B7280] max-[961px]:block leading-[1.45]";

/**
 * The Results tab: verdict, tiles, traffic distribution, variant performance (with the "not
 * proof" note), and the cumulative conversion-rate chart. Shared by the experiment page and the
 * public share page, so a shared link shows exactly what the team sees.
 */
export function ResultsPanel({
  m,
  onChooseWinner,
}: {
  m: ResultsModel;
  /** Opens "Choose winner"; absent for a Viewer and on the public share page. */
  onChooseWinner?: (() => void) | undefined;
}) {
  const choice = m.winnerChoice;
  const recommendedName = choice.options.find((o) => o.key === choice.recommendedKey)?.name ?? null;
  // Prompt where a decision is due: a live result Routely recommends, or an ended experiment
  // nobody has chosen for yet. Otherwise "End and choose winner" stays in the header's menu.
  const cta = !onChooseWinner
    ? null
    : !choice.ending
      ? choice.currentKey === null
        ? "Choose winner"
        : null
      : recommendedName
        ? `End and keep ${recommendedName}`
        : null;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hover = chartHover(m.chart, hoverIdx);

  const plotMove = (ev: MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const fr = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(fr * (m.chart.days - 1)));
  };

  return (
    <>
      <section
        aria-labelledby="exp-verdict"
        className="flex flex-col gap-3.5 rounded-xl border px-5 py-[18px]"
        style={{ borderColor: m.verdict.border, background: m.verdict.bg }}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex size-9 flex-[0_0_36px] items-center justify-center rounded-lg"
            style={{ background: m.verdict.iconBg, color: m.verdict.fg }}
          >
            <VerdictIcon kind={m.verdict.kind} />
          </span>
          <div className="flex min-w-0 flex-col gap-[3px]">
            <h2
              id="exp-verdict"
              className="m-0 text-base leading-6 font-bold"
              style={{ color: m.verdict.ink }}
            >
              {m.verdict.title}
            </h2>
            <p className="m-0 text-sm leading-[21px] text-pretty text-[#374151]">
              {m.verdict.body}
            </p>
            {m.verdict.nextStep ? (
              <p className="m-0 mt-1 text-sm leading-[21px] text-pretty text-[#374151]">
                <span className="font-semibold text-[#111827]">Next step: </span>
                {m.verdict.nextStep}
              </p>
            ) : null}
            {cta ? (
              <button
                type="button"
                onClick={onChooseWinner}
                className="mt-2 inline-flex h-9 w-fit cursor-pointer items-center justify-center rounded-lg border-0 bg-[#0070C9] px-4 text-[13px] font-semibold whitespace-nowrap text-white hover:brightness-[.8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
              >
                {cta}
              </button>
            ) : null}
          </div>
        </div>
        {m.verdict.kind === "wait" ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-2.5">
            {m.verdict.progress.map((pg) => (
              <div
                key={pg.key}
                className="flex flex-col gap-2.5 rounded-lg border border-[#EEF0F3] bg-white px-3.5 py-3"
              >
                <span className="flex items-center gap-2 text-sm leading-[1.45] font-semibold text-[#111827]">
                  <span
                    aria-hidden
                    className="size-2.5 flex-[0_0_10px] rounded-[3px]"
                    style={{ background: pg.color }}
                  />
                  {pg.name}
                </span>
                <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 max-[641px]:grid-cols-1">
                  <ProgressBar label="Visitors" value={pg.vis} w={pg.visW} fill={pg.visFill} />
                  <ProgressBar
                    label="Conversions"
                    value={pg.conv}
                    w={pg.convW}
                    fill={pg.convFill}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-4 gap-3 max-[961px]:grid-cols-2">
        {m.tiles.map((tl) => (
          <div
            key={tl.label}
            className="flex min-w-0 flex-col gap-1 rounded-xl border border-[#EEF0F3] bg-white px-[18px] py-4"
          >
            <span className="text-[13px] leading-[17px] text-[#6B7280]">{tl.label}</span>
            <span className="text-2xl leading-[30px] font-semibold tracking-[-0.02em] text-[#111827] tabular-nums">
              {tl.value}
            </span>
            <span className="text-[13px] leading-[17px] [overflow-wrap:anywhere] text-[#6B7280]">
              {tl.sub}
            </span>
          </div>
        ))}
      </div>

      <section aria-labelledby="exp-dist" className={cn(CARD, "gap-3.5 px-5 py-[18px]")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="exp-dist" className={H2}>
            Traffic distribution
          </h2>
          <p className={CAPTION}>{m.distCaption}</p>
        </div>
        <div
          role="img"
          aria-label={m.distAria}
          className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-[#F3F4F6]"
        >
          {m.dist.map((d) => (
            <span
              key={d.key}
              className="block h-full"
              style={{ width: d.w, background: d.color }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-[22px] gap-y-2">
          {m.dist.map((d) => (
            <span
              key={d.key}
              className="inline-flex items-center gap-2 text-sm leading-[1.45] text-[#374151]"
            >
              <span
                aria-hidden
                className="size-2.5 flex-[0_0_10px] rounded-[3px]"
                style={{ background: d.color }}
              />
              <span className="font-semibold">{d.name}</span>
              <span className="text-[#6B7280] tabular-nums">{d.label}</span>
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="exp-perf" className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-[18px] pb-3.5">
          <h2 id="exp-perf" className={H2}>
            Variant performance
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className={CAPTION}>Goal: {m.goalLabel}</p>
            {onChooseWinner ? (
              <button
                type="button"
                onClick={onChooseWinner}
                className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 text-[13px] font-medium whitespace-nowrap text-[#374151] hover:bg-[#F9FAFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
              >
                {choice.ending
                  ? "End and choose winner"
                  : choice.currentKey
                    ? "Change winner"
                    : "Choose winner"}
              </button>
            ) : null}
          </div>
        </div>
        <div role="table" aria-label="Variant performance">
          <div
            role="row"
            className={cn(
              VGRID,
              "border-t border-[#EEF0F3] bg-[#FAFBFC] px-5 py-[9px] text-xs leading-4 font-medium text-[#6B7280] max-[961px]:hidden [&>span:not(:first-child)]:text-right",
            )}
          >
            <span role="columnheader">Version</span>
            <span role="columnheader">Visitors</span>
            <span role="columnheader">Traffic share</span>
            <span role="columnheader">Conversions</span>
            <span role="columnheader">Conversion rate</span>
            <span role="columnheader">Lift vs Control</span>
            <span role="columnheader">Chance to beat Control</span>
          </div>
          {m.rows.map((r) => (
            <div
              key={r.key}
              role="row"
              className={cn(
                VGRID,
                "border-t border-[#EEF0F3] px-5 py-3.5",
                "max-[961px]:grid-cols-3 max-[961px]:items-start max-[961px]:gap-y-3 max-[961px]:px-4 max-[961px]:[grid-template-areas:'ver_ver_ver'_'vis_share_conv'_'rate_lift_chance']",
              )}
            >
              <div
                role="cell"
                className="flex min-w-0 flex-col gap-[3px] max-[961px]:[grid-area:ver]"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 flex-[0_0_8px] rounded-full"
                      style={{ background: r.color }}
                    />
                    <span className="text-sm leading-5 font-semibold text-[#111827]">{r.name}</span>
                  </span>
                  {r.isBest ? (
                    <span className="inline-flex h-6 items-center rounded-md bg-[#DCFCE7] px-2 text-xs leading-[1.45] font-semibold text-[#166534]">
                      {r.bestLabel}
                    </span>
                  ) : null}
                </span>
                <span className="text-[13px] leading-[18px] [overflow-wrap:anywhere] text-[#6B7280]">
                  {r.desc}
                </span>
              </div>
              <NumCell area="vis" label="Visitors" value={r.vis} />
              <NumCell area="share" label="Traffic share" value={r.share} plain />
              <NumCell area="conv" label="Conversions" value={r.conv} />
              <NumCell area="rate" label="Conv. rate" value={r.rate} />
              <NumCell area="lift" label="Lift" value={r.lift} color={r.liftFg} />
              <NumCell area="chance" label="Chance to beat" value={r.chance} color={r.chanceFg} />
            </div>
          ))}
        </div>
        {m.notProof ? (
          <p className="m-0 border-t border-[#EEF0F3] px-5 py-3 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
            {m.notProof}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="exp-chart" className={cn(CARD, "gap-4 px-5 py-[18px]")}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="flex flex-col gap-0.5">
            <h2 id="exp-chart" className={H2}>
              Conversion rate over time
            </h2>
            <p className={CAPTION}>Cumulative, by version</p>
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
            {m.chart.legend.map((lg, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[13px] text-[#374151]">
                <span
                  aria-hidden
                  className="h-0.5 w-3 rounded-[2px]"
                  style={{ background: lg.color }}
                />
                {lg.name}
              </span>
            ))}
          </div>
        </div>
        {m.chart.ok ? (
          <div className="flex flex-col gap-2">
            <div className="flex h-[220px]">
              <div aria-hidden className="relative w-11 flex-[0_0_44px]">
                {m.chart.yTicks.map((t) => (
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
                aria-label={m.chart.aria}
                onMouseMove={plotMove}
                onClick={plotMove}
                onMouseLeave={() => setHoverIdx(null)}
                className="relative min-w-0 flex-auto cursor-crosshair"
              >
                {m.chart.yTicks.map((t) => (
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
                  {m.chart.lines.map((ln) => (
                    <path
                      key={ln.key}
                      d={ln.d}
                      fill="none"
                      stroke={ln.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                {hover.hasHover ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#9CA3AF]"
                    style={{ left: hover.hx }}
                  />
                ) : null}
                {hover.dots.map((dt) => (
                  <div
                    key={dt.key}
                    aria-hidden
                    className="pointer-events-none absolute size-[9px] -translate-x-1/2 translate-y-1/2 rounded-full shadow-[0_0_0_2px_#FFFFFF]"
                    style={{ left: dt.left, bottom: dt.bottom, background: dt.color }}
                  />
                ))}
                {hover.hasHover ? (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute top-1 z-[3] flex min-w-[160px] flex-col gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-2 whitespace-nowrap text-[#111827] shadow-[0_8px_24px_#1118271F,0_1px_3px_#1118270F]"
                    style={{ left: hover.hx, transform: hover.tipTx }}
                  >
                    <span className="text-xs leading-4 text-[#6B7280]">{hover.tipDate}</span>
                    {hover.tipRows.map((tp) => (
                      <span
                        key={tp.key}
                        className="flex items-center justify-between gap-3 text-[13px] leading-[17px]"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-[2px]" style={{ background: tp.color }} />
                          {tp.name}
                        </span>
                        <strong className="font-semibold tabular-nums">{tp.value}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div aria-hidden className="relative ml-11 h-4">
              {m.chart.xTicks.map((t) => (
                <span
                  key={t.key}
                  className="absolute top-0 text-xs leading-4 whitespace-nowrap text-[#6B7280]"
                  style={{ left: t.left, transform: t.tx }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2.5 rounded-lg bg-[#F9FAFB] p-4 text-center">
            <span
              aria-hidden
              className="inline-flex size-10 items-center justify-center rounded-full bg-[#F3F4F6] text-[#4B5563]"
            >
              <ChartIcon size={20} />
            </span>
            <p className="m-0 text-sm leading-[1.45] font-semibold text-[#111827]">
              {m.chart.waiting === "second-day"
                ? "The chart starts on day 2"
                : "Waiting for the first visitors"}
            </p>
            <p className="m-0 max-w-[340px] text-[13px] leading-[19px] text-[#4B5563]">
              {m.chart.waiting === "second-day"
                ? "Each line shows a version’s conversion rate day by day, so it needs at least two days of data. The numbers above are up to date."
                : "This chart fills in as visitors see your versions and reach the goal page."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function ProgressBar({
  label,
  value,
  w,
  fill,
}: {
  label: string;
  value: string;
  w: string;
  fill: string;
}) {
  return (
    <div className="flex flex-col gap-[5px]">
      <span className="flex justify-between gap-2 text-xs leading-[1.45]">
        <span className="text-[#6B7280]">{label}</span>
        <span className="font-semibold text-[#374151] tabular-nums">{value}</span>
      </span>
      <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-[#F3F4F6]">
        <span className="block h-full rounded-full" style={{ width: w, background: fill }} />
      </span>
    </div>
  );
}

const AREAS = {
  vis: "max-[961px]:[grid-area:vis]",
  share: "max-[961px]:[grid-area:share]",
  conv: "max-[961px]:[grid-area:conv]",
  rate: "max-[961px]:[grid-area:rate]",
  lift: "max-[961px]:[grid-area:lift]",
  chance: "max-[961px]:[grid-area:chance]",
};

function NumCell({
  area,
  label,
  value,
  color = "#111827",
  plain = false,
}: {
  area: keyof typeof AREAS;
  label: string;
  value: string;
  color?: string;
  /** Traffic share is set in regular weight and a softer grey. */
  plain?: boolean;
}) {
  return (
    <div role="cell" className={cn("flex flex-col gap-0.5 text-right", AREAS[area])}>
      <span className={MLABEL}>{label}</span>
      <span
        className={cn("text-sm leading-[1.45] tabular-nums", !plain && "font-semibold")}
        style={{ color: plain ? "#374151" : color }}
      >
        {value}
      </span>
    </div>
  );
}

function VerdictIcon({ kind }: { kind: "win" | "flat" | "wait" | "collect" }) {
  if (kind === "win")
    return (
      <Svg strokeWidth={1.8}>
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
        <path d="M17 5h3v2a3 3 0 0 1-3 3" />
        <path d="M7 5H4v2a3 3 0 0 0 3 3" />
      </Svg>
    );
  if (kind === "flat")
    return (
      <Svg>
        <path d="M5 9h14" />
        <path d="M5 15h14" />
      </Svg>
    );
  if (kind === "wait")
    return (
      <Svg strokeWidth={1.8}>
        <path d="M6 3h12" />
        <path d="M6 21h12" />
        <path d="M7 3v3a5 5 0 0 0 10 0V3" />
        <path d="M7 21v-3a5 5 0 0 1 10 0v3" />
      </Svg>
    );
  return (
    <Svg strokeWidth={1.8}>
      <path d="M3 12h3l3-7 4 14 3-7h5" />
    </Svg>
  );
}
