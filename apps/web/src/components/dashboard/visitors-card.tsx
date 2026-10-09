import { CARD, CARD_TITLE } from "./conversions-card";
import type { DashboardView } from "./model";

/**
 * "Visitors over time" (v2): distinct visitors entering the project's experiments on each of the
 * last 14 project-local days, the 14-day unique total, the change of the last 7 days against the
 * 7 before, and one bar per day (today highlighted; each bar's tooltip carries the day's figures).
 */
export function VisitorsCard({ data }: { data: DashboardView["visitors"] }) {
  return (
    <section className={`${CARD} gap-1`}>
      <div className="flex items-center justify-between gap-2.5">
        <h2 className={CARD_TITLE}>Visitors over time</h2>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-[20px] border border-input px-[9px] text-xs font-bold whitespace-nowrap text-ink-2">
          <span aria-hidden className="size-1.5 rounded-full bg-brand" />
          Unique visitors · 14 d
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="font-heading text-[28px] font-bold tracking-[-0.02em] tabular-nums">
          {data.total}
        </span>
        {data.delta ? (
          <span className="text-[12.5px] font-extrabold" style={{ color: data.deltaColor }}>
            {data.delta}
          </span>
        ) : null}
      </div>
      <div className="text-[12.5px] text-ink-3">{data.avg} avg/day · vs previous 7 days</div>
      {data.has ? (
        <>
          <div
            role="img"
            aria-label={data.bars.map((b) => b.tip).join("; ")}
            className="mt-3.5 flex h-[200px] items-end gap-1.5 border-b border-border"
          >
            {data.bars.map((b, i) => (
              <div
                key={i}
                title={b.tip}
                className="min-w-1 flex-1 rounded-t-[3px] hover:opacity-75"
                style={{ height: b.height, background: b.today ? "#2B59F0" : "#C9D4F7" }}
              />
            ))}
          </div>
          <div aria-hidden className="mt-1.5 flex gap-1.5">
            {data.bars.map((b, i) => (
              <span key={i} className="flex-1 text-center text-[10.5px] text-faint">
                {b.label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-3.5 flex h-[200px] items-center justify-center border-t border-dashed border-border text-[13px] text-ink-3">
          No experiment traffic recorded in the last 14 days.
        </div>
      )}
    </section>
  );
}
