import { cn } from "@/lib/utils";

/**
 * A website's Google Sheets destination, and how to describe its health.
 *
 * Deliberately **not** a `"use client"` module. The helpers below are plain functions, and a plain
 * function exported from a client module cannot be called on the server — React can only render a
 * client export as a component or pass it as a prop. The integrations page is a server component and
 * needs to compute a status per website, so this lives apart from `website-sheet-card.tsx`.
 */

export interface SheetDestination {
  spreadsheetId: string;
  spreadsheetName: string | null;
  sheetTitle: string;
  createdByRoutely: boolean;
  refreshedAt: Date | null;
  rowCount: number;
  lastError: string | null;
}

export type SheetHealth = "live" | "waiting" | "error" | "none";

/**
 * How a destination is doing, as one value.
 *
 * Derived rather than stored, so the colour and the wording cannot disagree — the failure mode of
 * hand-writing the same three conditionals in three places.
 */
export function sheetHealth(destination: SheetDestination | null): SheetHealth {
  if (!destination) return "none";
  if (destination.lastError) return "error";
  // Refreshed but empty is a real state and not a fault: a website with no traffic in 30 days has
  // nothing to publish, and "0 rows" without that explanation reads as broken.
  if (!destination.refreshedAt || destination.rowCount === 0) return "waiting";
  return "live";
}

/** The short status word shown beside a website's name. */
export function sheetStatusLabel(destination: SheetDestination | null): string {
  return {
    none: "Not published",
    error: "Problem",
    live: "Live",
    waiting: "No data yet",
  }[sheetHealth(destination)];
}

const PILL: Record<SheetHealth, string> = {
  live: "bg-success-bg text-success-strong",
  waiting: "bg-warning-bg text-warning-text",
  error: "bg-danger-bg text-danger-text",
  none: "bg-divider text-ink-2",
};

const DOT: Record<SheetHealth, string> = {
  live: "bg-success",
  waiting: "bg-warning",
  error: "bg-destructive",
  none: "bg-faint",
};

/**
 * Status as a dot and a word.
 *
 * Always paired with text: colour alone is not information for a reader who cannot tell these hues
 * apart, and it carries no meaning on its own anyway.
 */
export function SheetStatus({ health, label }: { health: SheetHealth; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold whitespace-nowrap",
        PILL[health],
      )}
    >
      <span className={cn("size-[7px] rounded-full", DOT[health])} aria-hidden />
      {label}
    </span>
  );
}

/** The spreadsheet's own URL, built from its id so a renamed or moved file still opens. */
export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}

/**
 * Status, with the way out to the spreadsheet directly beneath it.
 *
 * One component rather than two placements, so the integrations list and a website's own page cannot
 * end up describing the same destination differently — which they already had, the website page
 * having quietly lost its status indicator when the list gained one.
 */
export function SheetStatusColumn({
  destination,
  className,
}: {
  destination: SheetDestination | null;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      <SheetStatus health={sheetHealth(destination)} label={sheetStatusLabel(destination)} />

      {destination ? (
        <a
          href={spreadsheetUrl(destination.spreadsheetId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-bold whitespace-nowrap text-primary hover:text-brand-hover"
        >
          View spreadsheet ↗
        </a>
      ) : null}
    </div>
  );
}
