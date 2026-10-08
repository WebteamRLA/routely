"use client";

import { CardTitle, ConfidenceBar, Section } from "@/components/rl";
import { armName } from "@/lib/domain";
import { fP, fS } from "@/lib/format";
import { computeStats } from "@/lib/stats";
import type { GoalPerformance } from "@/lib/view-models";

import { liftColor } from "./model";

const GRID = "grid grid-cols-[minmax(200px,1.4fr)_96px_150px_90px_minmax(170px,1.2fr)]";

/** Best variant vs Control on every tracked goal; a row click switches the report's goal. */
export function GoalPerformanceTable({
  goals,
  selected,
  threshold,
  onSelect,
}: {
  goals: GoalPerformance[];
  selected: string;
  threshold: number;
  onSelect: (goalKey: string) => void;
}) {
  return (
    <Section clip>
      <div className="flex flex-wrap items-baseline justify-between gap-2.5 border-b border-divider px-[18px] py-3.5">
        <CardTitle>Goal performance</CardTitle>
        <span className="text-[12.5px] text-ink-3">
          Best variant vs Control on every tracked goal. Select a goal to switch the report.
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div
            className={`${GRID} table-head gap-3.5 border-b border-divider bg-subtle px-[18px] py-[9px]`}
          >
            <div>Goal</div>
            <div className="text-right">Control</div>
            <div className="text-right">Best variant</div>
            <div className="text-right">Lift</div>
            <div>Chance to beat control</div>
          </div>
          {goals.map((g) => {
            const sorted = [...g.arms].sort((a, b) => a.position - b.position);
            const st = computeStats(
              sorted.map((a) => ({ name: armName(a.position), v: a.v, c: a.c })),
            );
            const best = st.arms
              .slice(1)
              .reduce<(typeof st.arms)[number] | null>((x, a) => (!x || a.cr > x.cr ? a : x), null);
            const prob = best && st.v ? best.prob : null;
            const on = g.goal.key === selected;
            return (
              <button
                key={g.goal.key}
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(g.goal.key)}
                className={`${GRID} w-full cursor-pointer items-center gap-3.5 border-0 border-b border-divider px-[18px] py-3 text-left text-ink tabular-nums outline-none hover:bg-brand-tint focus-visible:ring-3 focus-visible:ring-primary/30 focus-visible:ring-inset`}
                style={{ background: on ? "#F5F8FF" : undefined }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex-none rounded-sm px-1.5 py-0.5 text-[10px] font-extrabold tracking-[0.06em] uppercase"
                    style={{
                      background: g.primary ? "#0A1633" : "#F1F3F6",
                      color: g.primary ? "#FFFFFF" : "#4B5568",
                    }}
                  >
                    {g.primary ? "Primary" : "Secondary"}
                  </span>
                  <span className="truncate font-extrabold">{g.goal.name}</span>
                  <span className="truncate font-mono text-[11.5px] text-ink-3">
                    {g.goal.eventKey}
                  </span>
                </div>
                <div className="text-right font-semibold">{fP(st.arms[0]?.cr ?? 0, 2)}</div>
                <div className="text-right font-semibold">
                  {best ? `${best.name} · ${fP(best.cr, 2)}` : "—"}
                </div>
                <div
                  className="text-right font-extrabold"
                  style={{ color: best ? liftColor(best.lift) : "#5B6579" }}
                >
                  {best ? fS(best.lift) : "—"}
                </div>
                <ConfidenceBar prob={prob} threshold={threshold} />
              </button>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
