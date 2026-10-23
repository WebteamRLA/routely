/**
 * Turns a day's per-arm figures into the literal cell values appended to a customer's
 * spreadsheet.
 *
 * Pure and dependency-free so the exact bytes that reach Google can be asserted in a unit test
 * rather than inferred from a successful HTTP call.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 * - **Numbers are emitted as JSON numbers, not strings.** A quoted `"412"` lands in Sheets as
 *   text, and text does not sum. The customer's whole reason for wanting this data in a
 *   spreadsheet is to add it up.
 * - **Text is emitted verbatim, and the caller must send it with `valueInputOption=RAW`.** An
 *   experiment name is customer-controlled free text, and under `USER_ENTERED` a name beginning
 *   with `=` would be stored as a live formula in the customer's spreadsheet — a stored-formula
 *   injection, with `IMPORTXML` and friends available to it. `RAW` is what makes that a string.
 *   Nothing is escaped or prefixed here, because mangling the name would be the wrong fix and
 *   would show up in the sheet.
 */

import type { UtcDayKey } from "@/lib/utc-day";

/**
 * The columns, in order, exactly as they are written to the header row.
 *
 * `Date (UTC)` says which timezone the day belongs to, because the boundary is not the
 * customer's local midnight and a bare `Date` would imply it was.
 *
 * `Conversion Rate (%)` is a percentage, not a fraction: a spreadsheet reader sees `7.3` and
 * reads 7.3%, whereas `0.073` invites its own percentage formatting on top.
 */
export const SHEET_COLUMNS = [
  "Date (UTC)",
  "Experiment",
  "Variant",
  "Visitors",
  "Conversions",
  "Conversion Rate (%)",
] as const;

/** How many columns a row occupies. Used to build the A1 range. */
export const SHEET_COLUMN_COUNT = SHEET_COLUMNS.length;

/** A single cell. `""` is how a figure that does not exist is written — see `percentCell`. */
export type SheetCell = string | number;

/** One arm's figures for one day, as the analytics layer produces them. */
export interface DailyArmFigures {
  experimentName: string;
  /** "Control", or the variant's stored name — see `armLabel`. */
  variantLabel: string;
  assignedVisitors: number;
  conversions: number;
  /** A fraction (0.073), not a percentage. Null when nobody was assigned. */
  conversionRate: number | null;
}

/** The header row. A function rather than a constant so the caller cannot mutate the source. */
export function headerRow(): string[] {
  return [...SHEET_COLUMNS];
}

/** A configured variant, as `armLabel` needs it. */
export interface LabelledVariant {
  id: string;
  /** `ExperimentVariant.name` ("Variant A" by default, editable for Split URL tests). */
  name: string;
}

/**
 * The label for one arm of an experiment — the same name the experiment page shows.
 *
 * A NULL `variantId` is the control — control is deliberately not a row in `ExperimentVariant`
 * (see the schema header), so its absence from the list *is* its identity.
 *
 * A variant is labelled by its stored name, so "Variant A" (or a customer's own "Blue banner")
 * reads the same in the spreadsheet as on the experiment page. A blank name falls back to the
 * letter for its place in `orderedVariants` — ordered by `ExperimentVariant.position` ascending —
 * exactly as `experiment-results.service.ts` does, so the two never disagree. The name is
 * customer-controlled text and is returned verbatim; `valueInputOption=RAW` is what keeps a
 * formula-shaped name inert (see the file header).
 *
 * An id that is not in the list belongs to a variant deleted since the data was collected. It
 * keeps a label rather than being dropped, because the visitors it counted were real.
 */
export function armLabel(
  variantId: string | null,
  orderedVariants: readonly LabelledVariant[],
): string {
  if (variantId === null) return "Control";

  const index = orderedVariants.findIndex((variant) => variant.id === variantId);
  if (index === -1) return "Removed variant";
  return orderedVariants[index]!.name.trim() || `Variant ${String.fromCharCode(65 + index)}`;
}

/**
 * A conversion rate as a one-decimal percentage, or `""` when there is no rate.
 *
 * One decimal because that is what `formatPercent` renders in the dashboard. Writing full float
 * precision would let the spreadsheet and the page disagree in the third decimal, which reads
 * as a bug in the numbers rather than a difference in rounding. Nothing is lost: Visitors and
 * Conversions are both on the row, so anyone who wants exact precision can divide.
 *
 * Null becomes an empty cell rather than `0`. Nobody assigned means the rate is unknown, and a
 * `0` there would average into a customer's column as a real zero.
 */
export function percentCell(rate: number | null): number | "" {
  if (rate === null || !Number.isFinite(rate)) return "";
  return Math.round(rate * 1000) / 10;
}

/** One arm's figures, carrying the day they describe. */
export interface DatedArmFigures extends DailyArmFigures {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
}

/**
 * Rows spanning several days, ready to write.
 *
 * The caller's order is preserved — `getArmRowsByDay` returns oldest day first, with each day's
 * experiments together and control before its variants, which is the order a person reads a report
 * in. A spreadsheet's row order is the only grouping it has.
 */
export function buildDatedSheetRows(figures: readonly DatedArmFigures[]): SheetCell[][] {
  return figures.map((row) => [
    row.day,
    row.experimentName,
    row.variantLabel,
    row.assignedVisitors,
    row.conversions,
    percentCell(row.conversionRate),
  ]);
}

/**
 * The rows for one day, ready to append.
 *
 * Order is the caller's — `getDailyArmRows` returns experiments together with control first —
 * and is preserved, because a spreadsheet's row order is the only grouping an appended log has.
 */
export function buildSheetRows(day: UtcDayKey, figures: readonly DailyArmFigures[]): SheetCell[][] {
  return figures.map((row) => [
    day,
    row.experimentName,
    row.variantLabel,
    row.assignedVisitors,
    row.conversions,
    percentCell(row.conversionRate),
  ]);
}
