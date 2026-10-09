"use client";

import { useState } from "react";
import Link from "next/link";

import type { ExperimentRow, ExperimentTab } from "@/components/dashboard/model";
import { Segmented, STATUS_STYLE } from "@/components/rl";
import { cn } from "@/lib/utils";

const TONE = {
  good: "text-success-text",
  warn: "text-warning-text",
  bad: "text-danger-text",
  neutral: "text-foreground",
} as const;

/** Table columns at ≥ 900px; the action button sits in the last, unlabelled column. */
const GRID =
  "grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_auto]";

/**
 * The dashboard's Experiments section: title with a count, "View all", a pill filter (All
 * experiments · Running · Needs action) and one table. Rows that need a decision carry an amber
 * accent on their leading edge and say why in the "Needs action" column.
 */
export function ExperimentsOverview({
  rows,
  counts,
  viewAllHref,
}: {
  rows: ExperimentRow[];
  counts: Record<ExperimentTab, number>;
  viewAllHref: string;
}) {
  const [tab, setTab] = useState<ExperimentTab>(counts.action ? "action" : "all");
  const shown = rows.filter((r) =>
    tab === "all" ? true : tab === "running" ? r.running : r.needsAction !== null,
  );

  return (
    <section aria-labelledby="dash-experiments" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2
            id="dash-experiments"
            className="font-heading text-[17px] font-bold tracking-[-0.01em]"
          >
            Experiments
          </h2>
          <span className="rounded-md bg-secondary px-1.5 py-px text-xs font-bold text-ink-2 tabular-nums">
            {counts.all}
          </span>
        </div>
        <Link
          href={viewAllHref}
          className="text-[13px] font-bold text-ink-3 no-underline hover:text-foreground hover:no-underline"
        >
          View all →
        </Link>
      </div>

      <Segmented
        variant="pill"
        role="tab"
        ariaLabel="Filter experiments"
        value={tab}
        onChange={setTab}
        options={[
          { value: "all", label: "All experiments" },
          { value: "running", label: "Running" },
          {
            value: "action",
            label: (
              <>
                Needs action
                {counts.action ? (
                  <span
                    aria-label={`${counts.action} need action`}
                    className="size-1.5 rounded-full bg-coral"
                  />
                ) : null}
              </>
            ),
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(10,22,51,0.04)]">
        <div
          className={cn(
            "hidden items-center gap-4 border-b border-border bg-subtle px-[18px] py-3 text-[12.5px] font-bold text-ink-3 nav:grid",
            GRID,
          )}
        >
          <div>Experiment</div>
          <div>Needs action</div>
          <div>Visitors</div>
          <div>Traffic share</div>
          <div>Conversion rate</div>
          <div className="w-[116px]" />
        </div>

        {shown.length ? (
          shown.map((r) => <Row key={r.id} row={r} />)
        ) : (
          <div className="px-[18px] py-8 text-center text-[13.5px] text-ink-3">
            {tab === "action"
              ? "Nothing needs a decision right now."
              : tab === "running"
                ? "Nothing is running. Launch a draft or start a new test to begin collecting data."
                : "No experiments in progress."}
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ row: r }: { row: ExperimentRow }) {
  const dot = STATUS_STYLE[r.status].gc;
  return (
    <div
      className={cn(
        "relative border-b border-divider last:border-b-0 hover:bg-subtle",
        r.needsAction &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[#D9A13B]",
      )}
    >
      {/* Desktop: the row is the table line. */}
      <div className={cn("hidden items-center gap-4 px-[18px] py-3.5 nav:grid", GRID)}>
        <Link
          href={r.href}
          className="flex min-w-0 items-center gap-3 text-foreground no-underline hover:text-foreground hover:no-underline"
        >
          <Tile row={r} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-bold">{r.name}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: dot }}
              />
              <span className="truncate">
                {r.statusLine} · {r.typeLabel}
              </span>
            </span>
          </span>
        </Link>
        <div
          className={cn(
            "truncate text-[13px] font-bold",
            r.needsAction ? TONE[r.actionTone] : "text-faint",
          )}
        >
          {r.needsAction ?? "—"}
        </div>
        <div className="tabular-nums">
          <div className="text-[13.5px] font-bold">{r.visitors}</div>
          <div className="text-xs text-ink-3">{r.variantsLabel}</div>
        </div>
        <ShareCell row={r} />
        <div className="min-w-0 tabular-nums">
          <div className="text-[13.5px] font-bold">{r.conversionRate}</div>
          <div className="truncate text-xs" style={{ color: r.resultColor }}>
            {r.resultLabel}
          </div>
        </div>
        <ActionButton row={r} />
      </div>

      {/* Below 900px: a stacked card. */}
      <div className="flex flex-col gap-3 px-4 py-3.5 nav:hidden">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={r.href}
            className="flex min-w-0 items-center gap-3 text-foreground no-underline hover:text-foreground hover:no-underline"
          >
            <Tile row={r} />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-bold">{r.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: dot }}
                />
                <span className="truncate">{r.statusLine}</span>
              </span>
            </span>
          </Link>
          <ActionButton row={r} />
        </div>
        {r.needsAction ? (
          <div className={cn("text-[12.5px] font-bold", TONE[r.actionTone])}>{r.needsAction}</div>
        ) : null}
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-ink-3">Visitors</div>
            <div className="text-[13px] font-bold tabular-nums">{r.visitors}</div>
          </div>
          <div>
            <div className="text-ink-3">Traffic share</div>
            <div className="text-[13px] font-bold tabular-nums">{r.shareLabel}</div>
          </div>
          <div className="min-w-0">
            <div className="text-ink-3">Conv. rate</div>
            <div className="truncate text-[13px] font-bold tabular-nums">{r.conversionRate}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ row }: { row: ExperimentRow }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-lg font-heading text-[13px] font-bold text-white"
      style={{ background: row.tileColor }}
    >
      {row.initial}
    </span>
  );
}

function ShareCell({ row }: { row: ExperimentRow }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-bold tabular-nums">{row.shareLabel}</div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] bg-divider">
        <div
          className="h-full rounded-[3px] bg-brand"
          style={{ width: `${Math.round(row.share * 100)}%` }}
        />
      </div>
    </div>
  );
}

function ActionButton({ row }: { row: ExperimentRow }) {
  return (
    <Link
      href={row.actionHref}
      className="grid h-9 w-[116px] shrink-0 place-items-center rounded-md bg-secondary text-[13px] font-bold text-foreground no-underline hover:bg-[#E4E7EE] hover:text-foreground hover:no-underline"
    >
      {row.actionLabel}
    </Link>
  );
}
