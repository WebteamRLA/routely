/**
 * The dashboard's "Export": one CSV row per experiment, built in the browser from the data the
 * page already holds. Pure, so it is unit-tested; `downloadCsv` is the only browser-bound part.
 */

export interface ExportRow {
  name: string;
  type: string;
  status: string;
  visitors: number;
  /** Primary-goal conversions across every arm. */
  conversions: number;
  /** conversions ÷ visitors across every arm; null with no visitors. */
  conversionRate: number | null;
  /** The best variant's rate — what the overview's "Conversion rate" column shows. */
  bestVariantRate: number | null;
  /** The best variant's lift vs control. */
  lift: number | null;
  /** "Ready to call — Winner found", or "". */
  needsAction: string;
}

export const CSV_HEADER = [
  "Experiment",
  "Type",
  "Status",
  "Visitors",
  "Conversions",
  "Conversion rate",
  "Best variant conversion rate",
  "Lift vs control (best variant)",
  "Needs action",
] as const;

/** A rate as "4.62%", with an ASCII sign on lifts so spreadsheets read it as a number. */
function pct(x: number | null, signed = false): string {
  if (x === null || !Number.isFinite(x)) return "";
  const text = (x * 100).toFixed(signed ? 1 : 2);
  const zero = Number(text) === 0; // "-0.0" rounds to nothing: no sign either way
  const value = zero ? text.replace("-", "") : text;
  return `${signed && !zero && x > 0 ? "+" : ""}${value}%`;
}

/**
 * Quotes a cell when it needs it, and defuses text a spreadsheet would run as a formula —
 * experiment names are customer-controlled, so "=HYPERLINK(…)" must stay text (OWASP's CSV
 * injection advice: prefix a single quote).
 */
export function csvCell(value: string | number, text = false): string {
  let s = String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function overviewCsv(rows: readonly ExportRow[]): string {
  const lines = [CSV_HEADER.map((h) => csvCell(h)).join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.name, true),
        csvCell(r.type),
        csvCell(r.status),
        csvCell(r.visitors),
        csvCell(r.conversions),
        csvCell(pct(r.conversionRate)),
        csvCell(pct(r.bestVariantRate)),
        csvCell(pct(r.lift, true)),
        csvCell(r.needsAction, true),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** "routely-overview-kestrel-2026-10-09.csv" */
export function exportFileName(projectName: string, now: Date = new Date()): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `routely-overview-${slug}-${day}.csv`;
}

/** Saves `csv` as a file. A byte-order mark lets Excel read the UTF-8 (names hold "—", "“"). */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
