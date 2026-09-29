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
  /** "Control", or "Variant N" — see `armLabel`. */
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

/**
 * The label for one arm of an experiment.
 *
 * A NULL `variantId` is the control — control is deliberately not a row in `ExperimentVariant`
 * (see the schema header), so its absence from the id list *is* its identity.
 *
 * Variants are numbered from their position in `orderedVariantIds`, which the caller must order
 * by `ExperimentVariant.position` ascending. That is the same ordering the dashboard renders, so
 * "Variant 2" means the same thing in the spreadsheet as it does on the experiment page — and
 * numbering them any other way would make the two disagree without either being wrong.
 *
 * An id that is not in the list belongs to a variant deleted since the data was collected. It
 * keeps a label rather than being dropped, because the visitors it counted were real.
 */
export function armLabel(variantId: string | null, orderedVariantIds: readonly string[]): string {
  if (variantId === null) return "Control";

  const index = orderedVariantIds.indexOf(variantId);
  return index === -1 ? "Removed variant" : `Variant ${index + 1}`;
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
