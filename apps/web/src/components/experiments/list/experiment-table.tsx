"use client";

import Link from "next/link";

import { type MenuItem, RowMenu, Section, StatusPill, TrafficBar } from "@/components/rl";
import type { DisplayStatusKey } from "@/lib/domain";

import type { ListRow } from "./row-model";

const GRID =
  "grid grid-cols-[minmax(250px,2.4fr)_112px_82px_112px_minmax(110px,1fr)_80px_80px_100px_80px_40px] gap-3";

export interface TableRow extends ListRow {
  href: string;
  displayStatus: DisplayStatusKey;
  menu: MenuItem[];
}

/** Desktop table (≥900px): wide grid scrolling inside its own wrapper (prototype L717–754). */
export function ExperimentTable({
  rows,
  onOpen,
}: {
  rows: TableRow[];
  onOpen: (href: string) => void;
}) {
  return (
    <Section as="div" className="hidden overflow-x-auto nav:block">
      <div className="min-w-[1180px]">
        <div className={`${GRID} table-head border-b border-border bg-subtle px-[18px] py-2.5`}>
          <div>Experiment</div>
          <div>Status</div>
          <div>Type</div>
          <div>Traffic</div>
          <div>Primary goal</div>
          <div className="text-right">Visitors</div>
          <div className="text-right">Conv. rate</div>
          <div className="text-right">Lift</div>
          <div>Updated</div>
          <div />
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            data-testid="experiment-row"
            onClick={() => onOpen(r.href)}
            className={`${GRID} relative cursor-pointer items-center border-b border-divider px-[18px] py-3 tabular-nums last:border-b-0 hover:bg-subtle`}
          >
            <div className="min-w-0">
              <Link
                href={r.href}
                onClick={(e) => e.stopPropagation()}
                className="block truncate font-bold text-ink no-underline hover:text-ink hover:no-underline"
              >
                {r.name}
              </Link>
              <div className="mt-[3px] truncate text-xs text-ink-3">
                <span className="font-mono">{r.path}</span> · Created {r.created}
              </div>
            </div>
            <div>
              <StatusPill status={r.displayStatus} />
            </div>
            <div className="text-[12.5px] font-semibold text-ink-2">{r.type}</div>
            <div>
              <TrafficBar
                size="xs"
                segments={r.weights.map((w, i) => ({ weight: w, position: i }))}
              />
              <div className="mt-1 font-mono text-[11.5px] text-ink-3">{r.split}</div>
            </div>
            <div className="min-w-0 truncate text-[13px] font-semibold">{r.goal}</div>
            <div className="text-right font-semibold">{r.visitors}</div>
            <div className="text-right font-semibold">{r.cr}</div>
            <div className="text-right">
              <div
                className="font-extrabold"
                style={{ color: r.liftCell === "—" ? undefined : r.liftColor }}
              >
                {r.liftCell}
              </div>
              <div className="text-[11.5px] whitespace-nowrap text-ink-3">{r.leaderSub}</div>
            </div>
            <div className="text-[12.5px] text-ink-3">{r.updated}</div>
            <RowMenu items={r.menu} label={`Actions for ${r.name}`} />
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Stacked cards below 900px (prototype L756–773). */
export function ExperimentCards({
  rows,
  onOpen,
}: {
  rows: TableRow[];
  onOpen: (href: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 nav:hidden">
      {rows.map((r) => (
        <Section
          as="div"
          key={r.id}
          data-testid="experiment-card"
          onClick={() => onOpen(r.href)}
          className="flex cursor-pointer flex-col gap-2.5 px-4 py-3.5"
        >
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <Link
                href={r.href}
                onClick={(e) => e.stopPropagation()}
                className="font-bold text-ink no-underline hover:text-ink hover:no-underline"
              >
                {r.name}
              </Link>
              <div className="mt-[3px] font-mono text-xs break-all text-ink-3">{r.path}</div>
            </div>
            <div className="flex items-center gap-1">
              <StatusPill status={r.displayStatus} />
              <RowMenu items={r.menu} label={`Actions for ${r.name}`} />
            </div>
          </div>
          <TrafficBar size="xs" segments={r.weights.map((w, i) => ({ weight: w, position: i }))} />
          <div className="grid grid-cols-3 gap-2 text-[12.5px]">
            <div>
              <div className="text-ink-3">{r.type}</div>
              <div className="font-bold">{r.split}</div>
            </div>
            <div>
              <div className="text-ink-3">Visitors · CR</div>
              <div className="font-bold">
                {r.visitors} · {r.cr}
              </div>
            </div>
            <div>
              <div className="text-ink-3">Leading</div>
              <div className="font-bold">
                {r.leader} <span style={{ color: r.liftColor }}>{r.lift}</span>
              </div>
            </div>
          </div>
        </Section>
      ))}
    </div>
  );
}
