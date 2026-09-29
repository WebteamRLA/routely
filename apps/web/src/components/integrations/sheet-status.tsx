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

const TEXT: Record<SheetHealth, string> = {
  live: "text-emerald-700 dark:text-emerald-500",
  waiting: "text-muted-foreground",
  error: "text-destructive",
  none: "text-muted-foreground",
};

const DOT: Record<SheetHealth, string> = {
  live: "bg-emerald-500",
  waiting: "bg-amber-500",
  error: "bg-destructive",
  none: "bg-muted-foreground/40",
};

/**
 * Status as a dot and a word.
 *
 * Always paired with text: colour alone is not information for a reader who cannot tell these hues
 * apart, and it carries no meaning on its own anyway.
 */
export function SheetStatus({ health, label }: { health: SheetHealth; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", TEXT[health])}>
      <span className={cn("size-1.5 rounded-full", DOT[health])} aria-hidden />
      {label}
    </span>
  );
}
