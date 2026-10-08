import Link from "next/link";

import type { LiveRow } from "@/components/dashboard/model";
import { ConfidenceBar, Section, StatusPill } from "@/components/rl";

const GRID = "grid-cols-[minmax(0,2.2fr)_80px_116px_minmax(130px,1fr)_100px]";

/**
 * "Live experiments" (running then paused): a five-column table at ≥ 1180px, stacked cards
 * below — both rendered, switched by CSS so there is no layout shift on hydration.
 */
export function LiveExperiments({
  rows,
  threshold,
  allHref,
}: {
  rows: LiveRow[];
  threshold: number;
  allHref: string;
}) {
  const thr = `${Math.round(threshold * 100)}%`;
  return (
    <Section
      clip
      title="Live experiments"
      meta={<>{rows.length} active</>}
      action={
        <Link href={allHref} className="text-[13px] font-bold">
          All experiments →
        </Link>
      }
    >
      {rows.length ? (
        <>
          <div className="hidden min-[1180px]:block">
            <div
              className={`grid ${GRID} table-head gap-3.5 border-b border-divider bg-subtle px-[18px] py-[9px]`}
            >
              <div>Experiment</div>
              <div className="text-right">Visitors</div>
              <div className="text-right">Lift · leader</div>
              <div>Chance to beat control</div>
              <div>Status</div>
            </div>
            {rows.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className={`grid w-full ${GRID} items-center gap-3.5 border-b border-divider bg-card px-[18px] py-[13px] text-left text-foreground tabular-nums no-underline hover:bg-subtle hover:text-foreground hover:no-underline`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold">{r.name}</div>
                  <div className="mt-[3px] truncate text-xs text-ink-3">
                    {r.type} · <span className="font-mono">{r.path}</span> · {r.day}
                  </div>
                </div>
                <div className="text-right font-semibold">{r.visitors}</div>
                <div className="text-right">
                  <div className="font-extrabold" style={{ color: r.liftColor }}>
                    {r.lift}
                  </div>
                  <div className="text-xs text-ink-3">{r.leader}</div>
                </div>
                <ConfidenceBar prob={r.prob} threshold={threshold} />
                <div>
                  <StatusPill status={r.status} />
                </div>
              </Link>
            ))}
          </div>

          <div className="min-[1180px]:hidden">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className="flex w-full flex-col gap-2 border-b border-divider bg-card px-4 py-3.5 text-left text-foreground no-underline hover:text-foreground hover:no-underline"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="font-bold">{r.name}</div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {r.type} · {r.day}
                    </div>
                  </div>
                  <StatusPill status={r.status} />
                </div>
                <div className="flex items-baseline gap-3.5 text-[12.5px]">
                  <span className="font-extrabold" style={{ color: r.liftColor }}>
                    {r.lift}
                  </span>
                  <span className="text-ink-3">
                    {r.leader} · {r.visitors} visitors
                  </span>
                </div>
                <ConfidenceBar prob={r.prob} threshold={threshold} />
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="px-[18px] py-7 text-[13.5px] text-ink-3">
          Nothing is running. Launch a draft or start a new test to begin collecting data.
        </div>
      )}

      <div className="flex items-center gap-2 px-[18px] py-2.5 text-xs text-ink-3">
        <span aria-hidden className="h-3 w-0.5 bg-navy" />
        Significance threshold {thr} · set in Settings
      </div>
    </Section>
  );
}
