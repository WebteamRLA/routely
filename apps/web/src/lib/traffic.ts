/**
 * Traffic split helpers shared by the wizard's Traffic step and the live edit on an experiment's
 * Setup tab.
 *
 * Arm weights are whole percentages of the traffic *included* in the experiment, control first,
 * always totalling 100. How many visitors are included at all is a separate number (coverage,
 * `Experiment.trafficAllocation`), kept apart so neither can drift from the other.
 */

// ---------------------------------------------------------------------------
// Wizard allocation (the design prototype's `evenSplit` and `setWeight`).
//
// The wizard edits arm weights as whole percentages of *included* traffic that always total
// 100 (control first). These return new arrays and never mutate their input.
// ---------------------------------------------------------------------------

/**
 * Splits 100 evenly across the arms; the rounding remainder goes to control (index 0).
 * Two arms → 50/50; three → 34/33/33; four → 25 each; five → 20 each.
 */
export function evenSplit<T extends { weight: number }>(arms: readonly T[]): T[] {
  const n = arms.length;
  if (n === 0) return [];
  const b = Math.floor(100 / n);
  return arms.map((a, i) => ({ ...a, weight: b + (i === 0 ? 100 - b * n : 0) }));
}

/**
 * Sets one arm's weight and rebalances the others so the set totals exactly 100.
 *
 * The typed value is coerced to an integer and clamped to 0–100. With two arms the other arm
 * takes `100 − value`. With three or more, the remaining `100 − value` is shared among the
 * other arms in proportion to their current weights (floored), or equally when they are all
 * zero, and the rounding remainder goes to the first other arm. The edited arm can therefore
 * never push the total over 100.
 */
export function setWeight<T extends { weight: number }>(
  arms: readonly T[],
  index: number,
  value: unknown,
): T[] {
  const out = arms.map((a) => ({ ...a }));
  if (index < 0 || index >= out.length) return out;

  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if (out.length === 1) {
    out[0]!.weight = v;
    return out;
  }
  if (out.length === 2) {
    out[index]!.weight = v;
    out[1 - index]!.weight = 100 - v;
    return out;
  }

  out[index]!.weight = v;
  const idx = out.map((_, j) => j).filter((j) => j !== index);
  const rest = 100 - v;
  const cur = idx.reduce((t, j) => t + Number(out[j]!.weight || 0), 0);
  let given = 0;
  for (const j of idx) {
    const w = cur
      ? Math.floor((rest * Number(out[j]!.weight || 0)) / cur)
      : Math.floor(rest / idx.length);
    out[j]!.weight = w;
    given += w;
  }
  out[idx[0]!]!.weight += rest - given;
  return out;
}

/** Sum of the arms' weights, coercing as the prototype does. */
export function totalWeight(arms: readonly { weight: number }[]): number {
  return arms.reduce((t, a) => t + Number(a.weight || 0), 0);
}
