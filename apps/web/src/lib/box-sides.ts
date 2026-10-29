/**
 * Padding and margin as four sides, for the visual editor's Gutenberg-style box control. The value
 * a change stores stays the CSS shorthand (`16px 24px`, checked by `lib/style-values.ts`
 * `isBoxValue`); this only translates between that text and the four fields the panel shows.
 *
 * Pure and dependency-free.
 */

/** Top, right, bottom, left — CSS's own order. */
export type Sides = [string, string, string, string];

export const BOX_UNITS = ["px", "%", "em", "rem"] as const;
export type BoxUnit = (typeof BOX_UNITS)[number];

/** One side as a number and a unit; `auto` (margin only) has no number. */
export interface SideParts {
  num: string;
  unit: BoxUnit | "auto";
}

/**
 * Expands one to four shorthand values to four sides, the way CSS does: `a` → all, `a b` →
 * vertical/horizontal, `a b c` → top, horizontal, bottom. Null for anything else.
 */
export function parseBox(value: string | undefined | null): Sides | null {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  const [a, b, c, d] = parts;
  if (parts.length === 1) return [a!, a!, a!, a!];
  if (parts.length === 2) return [a!, b!, a!, b!];
  if (parts.length === 3) return [a!, b!, c!, b!];
  if (parts.length === 4) return [a!, b!, c!, d!];
  return null;
}

/** The shortest shorthand for four sides. */
export function formatBox([top, right, bottom, left]: Sides): string {
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

/** `16px` → 16 / px, `1.5rem` → 1.5 / rem, `0` → 0 / px, `auto` → auto. Unknown units read as px. */
export function splitSide(side: string): SideParts {
  if (side === "auto") return { num: "", unit: "auto" };
  const match = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(side.trim());
  if (!match) return { num: "0", unit: "px" };
  const unit = (BOX_UNITS as readonly string[]).includes(match[2]!.toLowerCase())
    ? (match[2]!.toLowerCase() as BoxUnit)
    : "px";
  return { num: tidyNumber(match[1]!), unit };
}

/**
 * A side back to CSS. Numbers are rounded to two decimals and kept to four digits — what the
 * server accepts — and a zero is written as `0`. Negative values only where allowed (margin).
 */
export function joinSide({ num, unit }: SideParts, allowNegative: boolean): string {
  if (unit === "auto") return "auto";
  let n = Number.parseFloat(num);
  if (!Number.isFinite(n)) n = 0;
  if (!allowNegative && n < 0) n = 0;
  n = Math.max(-9999, Math.min(9999, Math.round(n * 100) / 100));
  return n === 0 ? "0" : `${n}${unit}`;
}

/** Computed values carry long fractions (`19.1953px`); the fields show two decimals at most. */
function tidyNumber(text: string): string {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0";
}
