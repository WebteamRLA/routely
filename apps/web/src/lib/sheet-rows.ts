/**
 * Turns per-arm figures into the literal cell values written to a customer's spreadsheet.
 *
 * The tab is laid out **one block per experiment**, so a project running several tests reads as
 * several small tables rather than one interleaved list:
 *
 *     Experiment | Homepage hero | Type | A/B test  | Status | Running | Created | 2026-10-26
 *     Date (UTC) | Variant       | Visitors | Conversions | Conversion Rate (%)
 *     2026-10-26 | Control       | 7        | 4           | 57.1
 *     2026-10-26 | Variant A     | …
 *     (blank)
 *     Experiment | Pricing page  | Type | Split URL | …
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

/**
 * The columns of an experiment's block, in order, exactly as written under its title row. The
 * experiment itself is named by the title row, not repeated on every line.
 *
 * `Date (UTC)` says which timezone the day belongs to, because the boundary is not the
 * customer's local midnight and a bare `Date` would imply it was.
 *
 * `Conversion Rate (%)` is a percentage, not a fraction: a spreadsheet reader sees `7.3` and
 * reads 7.3%, whereas `0.073` invites its own percentage formatting on top.
 */
export const SHEET_COLUMNS = [
  "Date (UTC)",
  "Variant",
  "Visitors",
  "Conversions",
  "Conversion Rate (%)",
] as const;

/** How many columns a block's data rows occupy. */
export const SHEET_COLUMN_COUNT = SHEET_COLUMNS.length;

/**
 * How many columns the tab is written across: the title row's four label/value pairs. Every row is
 * padded to this width, because `values.update` leaves cells it is not given untouched — a shorter
 * row would keep whatever an earlier layout wrote to its right.
 */
export const SHEET_WIDTH = 8;

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

/** One arm-day, with what the block's title row says about its experiment. */
export interface SectionArmFigures extends DatedArmFigures {
  experimentId: string;
  experimentType: "SPLIT_URL" | "AB_TEST";
  experimentStatus: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  /** `YYYY-MM-DD`, UTC — what tells apart two experiments that share a name. */
  experimentCreated: string;
}

/** The labels the dashboard uses for the same things. */
const TYPE_LABEL = { AB_TEST: "A/B test", SPLIT_URL: "Split URL" } as const;
const STATUS_LABEL = {
  DRAFT: "Draft",
  ACTIVE: "Running",
  PAUSED: "Paused",
  COMPLETED: "Completed",
} as const;

/** What the tab says when no experiment had any activity in the window. */
export const NO_ACTIVITY_NOTE = "No experiment activity in the last 30 days.";

const padded = (row: SheetCell[]): SheetCell[] => [
  ...row,
  ...Array.from({ length: Math.max(0, SHEET_WIDTH - row.length) }, () => ""),
];

/**
 * The whole tab: one block per experiment — a title row naming it, its type, status and creation
 * date; the column headers; its rows — and a blank row between blocks.
 *
 * Blocks are ordered by experiment name (then creation date, then id, so two experiments with the
 * same name always appear in the same order and are told apart by their Created date). Within a
 * block the caller's order is kept: `getWebsiteArmRowsByDay` returns oldest day first and control
 * before its variants, which is the order a person reads a report in.
 *
 * Every row is padded to `SHEET_WIDTH`. The experiment name is customer text, written verbatim —
 * `valueInputOption=RAW` is what keeps a formula-shaped name inert (see the file header).
 */
export function buildSheetSections(figures: readonly SectionArmFigures[]): SheetCell[][] {
  if (figures.length === 0) return [padded([NO_ACTIVITY_NOTE])];

  const blocks = new Map<string, SectionArmFigures[]>();
  for (const row of figures) {
    const block = blocks.get(row.experimentId) ?? [];
    block.push(row);
    blocks.set(row.experimentId, block);
  }

  const ordered = [...blocks.values()].sort((a, b) => {
    const [x, y] = [a[0]!, b[0]!];
    return (
      x.experimentName.localeCompare(y.experimentName) ||
      x.experimentCreated.localeCompare(y.experimentCreated) ||
      x.experimentId.localeCompare(y.experimentId)
    );
  });

  const out: SheetCell[][] = [];
  ordered.forEach((block, index) => {
    const first = block[0]!;
    if (index > 0) out.push(padded([]));
    out.push(
      padded([
        "Experiment",
        first.experimentName,
        "Type",
        TYPE_LABEL[first.experimentType],
        "Status",
        STATUS_LABEL[first.experimentStatus],
        "Created",
        first.experimentCreated,
      ]),
    );
    out.push(padded(headerRow()));
    for (const row of block) {
      out.push(
        padded([
          row.day,
          row.variantLabel,
          row.assignedVisitors,
          row.conversions,
          percentCell(row.conversionRate),
        ]),
      );
    }
  });
  return out;
}
