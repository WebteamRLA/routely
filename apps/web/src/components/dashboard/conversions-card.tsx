import Link from "next/link";

import type { DashboardView } from "./model";

/** Card shell shared by the dashboard's analytics and rail cards (v2: 8px radius, 18×20 padding). */
export const CARD = "flex min-w-0 flex-col rounded-lg border border-border bg-card px-5 py-[18px]";
export const CARD_TITLE = "m-0 font-heading text-[15px] font-bold tracking-[-0.01em]";

/**
 * "Conversions by running experiment" (v2): all-time primary-goal conversions of the running
 * experiments that have data, their pooled conversion rate, and a bar per experiment (top five).
 */
export function ConversionsCard({ data }: { data: DashboardView["conversions"] }) {
  return (
    <section className={`${CARD} gap-1`}>
      <div className="flex items-center justify-between gap-2.5">
        <h2 className={CARD_TITLE}>Conversions by running experiment</h2>
        <span className="text-xs whitespace-nowrap text-ink-3">All time</span>
      </div>
      <div className="font-heading text-[28px] font-bold tracking-[-0.02em] tabular-nums">
        {data.total}
      </div>
      <div className="text-[12.5px] text-ink-3">{data.sub}</div>
      <div className="mt-3.5 flex min-h-[200px] flex-col gap-3.5">
        {data.bars.map((c) => (
          <Link
            key={c.id}
            href={c.href}
            className="flex flex-col gap-1.5 text-foreground no-underline hover:text-foreground hover:no-underline"
          >
            <div className="flex justify-between gap-2.5 text-[13px]">
              <span className="min-w-0 truncate font-semibold">{c.name}</span>
              <span className="whitespace-nowrap tabular-nums">
                <b>{c.conversions}</b> <span className="text-ink-3">· {c.cr}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-sm bg-divider">
              <div className="h-full rounded-sm bg-brand" style={{ width: c.width }} />
            </div>
          </Link>
        ))}
        {data.bars.length === 0 ? (
          <div className="flex min-h-[200px] flex-1 items-center justify-center border-t border-dashed border-border text-[13px] text-ink-3">
            No conversions recorded yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}
