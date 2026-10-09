"use client";

import Link from "next/link";
import { useState } from "react";

import { useOpenInstall } from "./install-context";
import type { DashTab, OverviewRow } from "./model";
import { cn } from "@/lib/utils";

/** Rows shown under each tab (prototype `list.slice(0, 6)`); "View all" opens the full list. */
const MAX_ROWS = 6;

const COLS =
  "grid-cols-[minmax(0,2fr)_minmax(110px,0.9fr)_92px_minmax(100px,0.8fr)_118px_104px] gap-3";

const NO_ROWS: Record<DashTab, string> = {
  needs: "Nothing needs your attention. Every experiment is on track.",
  running: "Nothing is running. Launch a draft or start a new test.",
  all: "No experiments yet.",
};

/**
 * The Experiments section (v2): title with the count and "View all", the All · Running ·
 * Needs action tabs, and the table — six columns when the main column is at least 740px wide,
 * stacked rows below that. A row that needs action carries an amber leading edge and a navy
 * button; the whole row opens the experiment (a draft opens the wizard).
 */
export function ExperimentsOverview({
  rows,
  counts,
  viewAllHref,
}: {
  rows: OverviewRow[];
  counts: Record<DashTab, number>;
  viewAllHref: string;
}) {
  const [tab, setTab] = useState<DashTab>("all");
  const shown = rows
    .filter((r) => (tab === "running" ? r.running : tab === "needs" ? r.needsAction : true))
    .slice(0, MAX_ROWS);

  const tabs: { key: DashTab; label: string; n: number }[] = [
    { key: "all", label: "All experiments", n: counts.all },
    { key: "running", label: "Running", n: counts.running },
    { key: "needs", label: "Needs action", n: counts.needs },
  ];

  return (
    <section aria-labelledby="dash-experiments" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2
            id="dash-experiments"
            className="m-0 font-heading text-[15px] font-bold tracking-[-0.01em]"
          >
            Experiments
          </h2>
          <span className="rounded-[20px] bg-secondary px-2 py-0.5 text-xs font-bold text-ink-2 tabular-nums">
            {counts.all}
          </span>
        </div>
        <Link href={viewAllHref} className="text-[13px] font-bold">
          View all →
        </Link>
      </div>

      <div
        role="tablist"
        aria-label="Filter experiments"
        className="flex max-w-full gap-0.5 self-start overflow-x-auto rounded-lg bg-secondary p-[3px]"
      >
        {tabs.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 px-3 text-[13px] font-bold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-primary/30",
                on
                  ? "bg-card text-foreground shadow-[0_1px_2px_rgba(10,22,51,0.08)]"
                  : "bg-transparent text-ink-3 hover:text-foreground",
              )}
            >
              {t.label}
              {t.key === "needs" ? (
                t.n > 0 ? (
                  <span
                    aria-label={`${t.n} need action`}
                    className="size-1.5 rounded-full bg-coral"
                  />
                ) : null
              ) : (
                <span className="text-[11.5px] text-faint tabular-nums">{t.n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="@container overflow-hidden rounded-lg border border-border bg-card">
        {shown.length ? (
          <>
            <div
              className={cn(
                "hidden border-b border-divider bg-subtle py-2.5 pr-[18px] pl-5 text-xs font-bold text-ink-3 @min-[740px]:grid",
                COLS,
              )}
            >
              <div>Experiment</div>
              <div>Needs action</div>
              <div>Visitors</div>
              <div>Traffic share</div>
              <div>Conversion rate</div>
              <div />
            </div>
            {shown.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </>
        ) : (
          <div className="px-5 py-[30px] text-center text-[13.5px] text-ink-3">{NO_ROWS[tab]}</div>
        )}
      </div>
    </section>
  );
}

function Row({ row: r }: { row: OverviewRow }) {
  const accent = { borderLeftColor: r.needsAction ? "#D9930F" : "transparent" };
  return (
    <div
      className="relative border-b border-l-[3px] border-divider last:border-b-0 hover:bg-subtle"
      style={accent}
    >
      {/* Wide: the six-column table line. */}
      <div
        className={cn(
          "hidden items-center py-3 pr-[18px] pl-[17px] tabular-nums @min-[740px]:grid",
          COLS,
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Tile row={r} />
          <div className="min-w-0">
            <RowLink row={r} />
            <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
              <StatusLine row={r} />
              <span className="min-w-0 shrink-[9] truncate text-[11.5px] text-faint">
                {r.typeLabel}
              </span>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div
            className="flex items-center gap-1.5 text-[13px] font-bold"
            style={{ color: r.naColor }}
          >
            {r.na}
          </div>
          <div className="truncate text-[11.5px] text-ink-3">{r.naSub}</div>
        </div>
        <div>
          <div className="text-[13.5px] font-bold">{r.visitors}</div>
          <div className="text-[11.5px] text-ink-3">{r.variants}</div>
        </div>
        <div>
          <div className="text-[13px] font-bold">{r.share}</div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-[2px] bg-divider">
            <div className="h-full rounded-[2px] bg-brand" style={{ width: r.share }} />
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold">{r.cr}</div>
          <div className="truncate text-[11.5px] font-semibold" style={{ color: r.crSubColor }}>
            {r.crSub}
          </div>
        </div>
        <div className="flex justify-end">
          <ActionButton row={r} />
        </div>
      </div>

      {/* Narrow: stacked. */}
      <div className="flex flex-col gap-2.5 py-3.5 pr-4 pl-[13px] @min-[740px]:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <Tile row={r} />
          <div className="min-w-0 flex-1">
            <RowLink row={r} />
            <div className="mt-0.5 flex min-h-[19px] min-w-0 items-center overflow-hidden whitespace-nowrap">
              <StatusLine row={r} />
            </div>
          </div>
          <ActionButton row={r} />
        </div>
        <div className="grid grid-cols-3 gap-2.5 text-xs">
          <div className="min-w-0">
            <div className="text-ink-3">Needs action</div>
            <div className="font-bold" style={{ color: r.naColor }}>
              {r.na}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-ink-3">Visitors</div>
            <div className="font-bold tabular-nums">{r.visitors}</div>
          </div>
          <div className="min-w-0">
            <div className="text-ink-3">Conv. rate</div>
            <div className="font-bold tabular-nums">
              {r.cr}{" "}
              <span className="font-semibold" style={{ color: r.crSubColor }}>
                {r.liftShort}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The experiment name; its ::after stretches over the row so the whole row is the link. */
function RowLink({ row }: { row: OverviewRow }) {
  return (
    <Link
      href={row.href}
      className="block truncate text-[13.5px] font-bold text-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] hover:text-foreground hover:no-underline focus-visible:after:ring-3 focus-visible:after:ring-primary/30 focus-visible:after:ring-inset"
    >
      {row.name}
    </Link>
  );
}

/** "● Running · day 18": the type label beside it gives way first when the column is narrow. */
function StatusLine({ row }: { row: OverviewRow }) {
  return (
    <span className="flex min-w-0 items-center gap-[5px] text-xs text-ink-2">
      <span aria-hidden className="shrink-0 text-[9px]" style={{ color: row.glyphColor }}>
        {row.glyph}
      </span>
      <span className="truncate">
        {row.statusLabel} · {row.when}
      </span>
    </span>
  );
}

function Tile({ row }: { row: OverviewRow }) {
  return (
    <span
      aria-hidden
      className="grid size-[30px] shrink-0 place-items-center rounded-md font-heading text-[13px] font-bold"
      style={{ background: row.avBg, color: row.avColor }}
    >
      {row.initial}
    </span>
  );
}

function ActionButton({ row }: { row: OverviewRow }) {
  const openInstall = useOpenInstall();
  const cls = cn(
    "relative z-[1] inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md border px-3 text-[12.5px] font-bold whitespace-nowrap no-underline outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-primary/30",
    row.primary
      ? "border-navy bg-navy text-white hover:bg-[#16244A] hover:text-white"
      : "border-input bg-card text-foreground hover:bg-muted hover:text-foreground",
  );
  if ("install" in row.action)
    return (
      <button type="button" className={cls} onClick={openInstall}>
        {row.action.label}
      </button>
    );
  return (
    <Link href={row.action.href} className={cls}>
      {row.action.label}
    </Link>
  );
}
