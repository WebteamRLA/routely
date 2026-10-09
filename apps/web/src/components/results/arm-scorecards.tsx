import { KpiStrip, Tag } from "@/components/rl";
import { fN, fP, fS } from "@/lib/format";
import type { ArmStat } from "@/lib/stats";

import { liftColor, type ArmBadge } from "./model";

/** One joined card per arm: CR, visitors, conversions, lift and chance to beat control. */
export function ArmScorecards({ arms, badges }: { arms: ArmStat[]; badges: (ArmBadge | null)[] }) {
  return (
    <KpiStrip>
      {arms.map((a, i) => {
        const badge = badges[i];
        const winning = badge?.label === "Winner" || badge?.label === "Winning";
        return (
          <div
            key={a.i}
            className="relative flex flex-[1_1_220px] flex-col gap-2.5 px-5 pt-4 pb-[18px] tabular-nums"
            style={{ background: winning ? "#F4FBF7" : "#FFFFFF" }}
          >
            <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: a.color }} />
            <div className="flex min-h-5 items-center gap-2">
              <span className="text-[11.5px] font-extrabold tracking-[0.1em] uppercase">
                {a.name}
              </span>
              {badge ? <Tag tone={badge.tone}>{badge.label}</Tag> : null}
            </div>
            <div>
              <div className="font-heading text-[30px] leading-[1.1] font-bold tracking-[-0.02em]">
                {fP(a.cr, 2)}
              </div>
              <div className="mt-0.5 text-[12px] text-ink-3">conversion rate</div>
            </div>
            <div className="flex gap-5 text-[13px]">
              <div>
                <div className="text-[12px] text-ink-3">Visitors</div>
                <div className="font-extrabold">{fN(a.v)}</div>
              </div>
              <div>
                <div className="text-[12px] text-ink-3">Conversions</div>
                <div className="font-extrabold">{fN(a.c)}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2.5 border-t border-divider pt-2.5">
              <span
                className="font-heading text-[18px] font-bold"
                style={{ color: a.i ? liftColor(a.lift) : "#5B6579" }}
              >
                {a.i ? fS(a.lift) : "Baseline"}
              </span>
              <span className="text-[12.5px] font-semibold text-ink-2">
                {a.i
                  ? `${Math.round((a.prob ?? 0.5) * 100)}% chance to beat Control`
                  : "Reference for lift"}
              </span>
            </div>
          </div>
        );
      })}
    </KpiStrip>
  );
}
