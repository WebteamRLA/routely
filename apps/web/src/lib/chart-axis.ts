/**
 * The y-axis of the "conversion rate over time" charts — the experiment detail page and both
 * wizards' result phases — so their labels never crowd. A fixed 1% or 2% step gave a 50% rate
 * 26 or 51 labels in a 220px column, drawn on top of each other.
 */

/** Round steps, smallest first; the first that needs at most `MAX_INTERVALS` gaps wins. */
const STEPS = [1, 2, 5, 10, 20, 25] as const;
const MAX_INTERVALS = 6;

/**
 * The top of the axis and its tick values, in percent, for the highest rate drawn (0–1). Keeps
 * a little headroom above the line, never goes below 1% or above 100%.
 */
export function percentAxis(maxRate: number): { maxPct: number; ticks: number[] } {
  const raw = Math.min(100, Math.max(1, Math.ceil(maxRate * 100 + 0.4)));
  const step = STEPS.find((s) => Math.ceil(raw / s) <= MAX_INTERVALS) ?? 25;
  const maxPct = Math.ceil(raw / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= maxPct; t += step) ticks.push(t);
  return { maxPct, ticks };
}
