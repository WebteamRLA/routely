"use client";

import { useState } from "react";

import { ArmSwatch, CardTitle, Section, Tag, confColor } from "@/components/rl";
import { pathOf } from "@/lib/domain-normalize";
import type { ExperimentKind } from "@/lib/domain";
import { fN, fP, fS, formatDuration } from "@/lib/format";
import type { ArmStat } from "@/lib/stats";

import { liftColor, type ArmBadge } from "./model";

const GRID =
  "grid grid-cols-[minmax(190px,1.6fr)_68px_88px_96px_86px_80px_minmax(130px,1.2fr)_86px_104px]";

function armDetail(a: ArmStat, type: ExperimentKind): string {
  if (type === "redirect") return pathOf(a.url ?? "");
  if (!a.i) return "Original page";
  const n = a.changes?.length ?? 0;
  return `${n} change${n === 1 ? "" : "s"}`;
}

/** Variant comparison table, with the 95% interval rows behind "Show statistics". */
export function VariantComparison({
  arms,
  badges,
  totalVisitors,
  type,
  threshold,
  goalName,
  engagement,
}: {
  arms: ArmStat[];
  badges: (ArmBadge | null)[];
  totalVisitors: number;
  type: ExperimentKind;
  threshold: number;
  goalName: string;
  /** Per-arm page views and average visible time per page view, indexed like `arms`. */
  engagement: { pageViews: number; avgVisibleMs: number | null }[];
}) {
  const [showStats, setShowStats] = useState(false);

  const variants = arms.slice(1);
  let cLo = Math.min(0, ...variants.map((a) => a.lo ?? 0));
  let cHi = Math.max(0, ...variants.map((a) => a.hi ?? 0));
  const pad = (cHi - cLo) * 0.08 || 0.1;
  cLo -= pad;
  cHi += pad;
  const pos = (v: number) => (((v - cLo) / (cHi - cLo)) * 100).toFixed(1) + "%";
  const thr = Math.round(threshold * 100);

  return (
    <Section clip>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-divider px-[18px] py-3.5">
        <CardTitle>Variant comparison · {goalName}</CardTitle>
        <button
          type="button"
          aria-expanded={showStats}
          onClick={() => setShowStats((v) => !v)}
          className="h-8 cursor-pointer rounded-md border border-input bg-card px-3 text-[12.5px] font-bold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-primary/30"
        >
          {showStats ? "Hide statistics" : "Show statistics"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1080px]">
          <div
            className={`${GRID} table-head gap-3 border-b border-divider bg-subtle px-[18px] py-2.5`}
          >
            <div>Version</div>
            <div className="text-right">Traffic</div>
            <div className="text-right">Visitors</div>
            <div className="text-right">Conversions</div>
            <div className="text-right">Conv. rate</div>
            <div className="text-right">Lift</div>
            <div>Chance to beat control</div>
            <div className="text-right">Page views</div>
            <div className="text-right">Avg. visible time (approx.)</div>
          </div>
          {arms.map((a, i) => {
            const badge = badges[i];
            const winning = badge?.label === "Winner" || badge?.label === "Winning";
            const prob = a.prob ?? 0.5;
            return (
              <div
                key={a.i}
                className="border-b border-divider"
                style={{ background: winning ? "#F6FBF8" : "#FFFFFF" }}
              >
                <div className={`${GRID} items-center gap-3 px-[18px] py-3.5 tabular-nums`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ArmSwatch position={a.i} color={a.color} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold">{a.name}</span>
                        {badge ? (
                          <Tag tone={badge.tone} className="rounded-[5px]">
                            {badge.label}
                          </Tag>
                        ) : null}
                      </div>
                      <div className="truncate font-mono text-[11.5px] text-ink-3">
                        {armDetail(a, type)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-ink-2">
                    {totalVisitors ? fP(a.v / totalVisitors, 1) : "—"}
                  </div>
                  <div className="text-right font-semibold">{fN(a.v)}</div>
                  <div className="text-right font-semibold">{fN(a.c)}</div>
                  <div className="text-right font-extrabold">{fP(a.cr, 2)}</div>
                  <div
                    className="text-right font-extrabold"
                    style={{ color: a.i ? liftColor(a.lift) : "#5B6579" }}
                  >
                    {a.i ? fS(a.lift) : "Baseline"}
                  </div>
                  <div className="flex items-center gap-2">
                    {a.i ? (
                      <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-divider">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.round(prob * 100)}%`,
                            background: confColor(prob, threshold, "#9AA3B5"),
                          }}
                        />
                      </div>
                    ) : null}
                    <span className="min-w-9 text-right font-extrabold">
                      {a.i ? `${Math.round(prob * 100)}%` : "—"}
                    </span>
                  </div>
                  <div className="text-right font-semibold">
                    {fN(engagement[a.i]?.pageViews ?? 0)}
                  </div>
                  <div className="text-right font-semibold">
                    {formatDuration(engagement[a.i]?.avgVisibleMs ?? null)}
                  </div>
                </div>
                {showStats && a.i ? (
                  <div className="grid grid-cols-[minmax(200px,1.6fr)_minmax(0,3fr)_220px] items-center gap-3 px-[18px] pb-3.5 text-[12.5px]">
                    <div className="pl-5 text-ink-3">95% interval for lift</div>
                    <div className="relative h-3.5" data-testid="ci-bar">
                      <div className="absolute inset-x-0 top-1.5 h-0.5 bg-divider" />
                      <div className="absolute inset-y-0 w-px bg-navy" style={{ left: pos(0) }} />
                      <div
                        className="absolute top-[3px] h-2 rounded"
                        style={{
                          left: pos(a.lo ?? 0),
                          width:
                            ((((a.hi ?? 0) - (a.lo ?? 0)) / (cHi - cLo)) * 100).toFixed(1) + "%",
                          background:
                            (a.lo ?? 0) > 0 ? "#13A06B" : (a.hi ?? 0) < 0 ? "#D13B3B" : "#8DA3EE",
                        }}
                      />
                    </div>
                    <div className="text-ink-2">
                      <b>
                        {fS(a.lo ?? 0)} to {fS(a.hi ?? 0)}
                      </b>{" "}
                      · p = {(a.p ?? 1) < 0.001 ? "< 0.001" : (a.p ?? 1).toFixed(3)}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="px-[18px] py-2.5 text-[12px] leading-normal text-ink-3">
        Visible time is approximate: it measures how long the page was visible, not attention, and
        is comparable between arms only.
      </div>
      {showStats ? (
        <div className="bg-subtle px-[18px] py-3 text-[12.5px] leading-normal text-ink-3">
          Confidence = probability the variant beats Control (two-sided z-test on conversion rate).
          Interval = 95% range for the true relative lift. Significance threshold {thr}%, set in
          Settings → Project. Interval axis: {fS(cLo, 0)} to {fS(cHi, 0)}, vertical line = no
          change.
        </div>
      ) : null}
    </Section>
  );
}
