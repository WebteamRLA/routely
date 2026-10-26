/**
 * The style values a visual change may set — the one definition the server's schema
 * (`validation/visual-change.ts`) and the editor's panel both check against, so the panel never
 * accepts a value the server would refuse. Stricter than the SDK, which only refuses characters
 * that could reach beyond a property (`packages/sdk/src/apply.ts`).
 *
 * Pure and dependency-free, so the client bundle carries no validation library for it.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const LENGTH = /^-?\d{1,4}(?:\.\d{1,2})?(?:px|rem|em|%)$/;

export const FONT_WEIGHTS = [
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const;
export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;

/** `#1F3D2B`, `#abc`, `rgb(…)`, `rgba(…)`. */
export function isStyleColor(value: string): boolean {
  return HEX.test(value) || RGB.test(value);
}

/** `24px`, `1.5rem`, `120%` — a positive size. */
export function isFontSize(value: string): boolean {
  return LENGTH.test(value) && !value.startsWith("-") && parseFloat(value) > 0;
}

export function isFontWeight(value: string): boolean {
  return (FONT_WEIGHTS as readonly string[]).includes(value);
}

export function isTextAlign(value: string): boolean {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/** One to four of `16px`, `1rem`, `5%`, `0` (and `auto` for margin) — the CSS shorthand. */
export function isBoxValue(value: string, allowAuto: boolean): boolean {
  const parts = value.trim().split(/\s+/);
  return (
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every(
      (part) =>
        part === "0" ||
        (allowAuto && part === "auto") ||
        (LENGTH.test(part) && (allowAuto || !part.startsWith("-"))),
    )
  );
}
