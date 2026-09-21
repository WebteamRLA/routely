/**
 * Turning stored traffic settings into the percentages people actually read.
 *
 * Two facts are stored separately and on purpose (see `Experiment.controlWeight` in
 * schema.prisma): `trafficAllocation` decides how many visitors enter the experiment at all,
 * and the per-arm weights decide how the entered share is divided. Keeping them apart means
 * neither can drift from the other — but nobody thinks in "relative weight within the included
 * portion", so every screen composes them into one set of percentages of *total* traffic that
 * add up to 100.
 *
 * Shared by the wizard, the edit form, the experiment detail page and the public share page,
 * so a split is never displayed two subtly different ways.
 */

export interface ArmShares {
  /** Percentage of total site traffic reaching control. */
  control: number;
  /** Percentage of total site traffic reaching each variant, in the given order. */
  variants: number[];
  /** Percentage never entered into the experiment: `100 - trafficAllocation`. */
  excluded: number;
}

/**
 * Distributes a whole-number total across values, so displayed percentages always sum to
 * exactly `total` rather than showing a rounding shortfall. Largest-remainder, which puts the
 * leftover point on the arm with the strongest claim to it.
 */
export function roundToTotal(values: number[], total: number): number[] {
  const floors = values.map(Math.floor);
  const shortfall = total - floors.reduce((sum, value) => sum + value, 0);

  const order = values
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  const result = [...floors];
  for (let i = 0; i < shortfall; i += 1) {
    const target = order[i % order.length];
    if (target) result[target.index] = result[target.index]! + 1;
  }
  return result;
}

/**
 * Composes stored weights and allocation into percentages of total site traffic.
 *
 * Falls back to an even split across the arms when every weight is zero — a state validation
 * rejects, but a display helper must not divide by zero over data that somehow reached it.
 */
export function armShares(input: {
  controlWeight: number;
  variantWeights: number[];
  trafficAllocation: number;
}): ArmShares {
  const included = Math.min(Math.max(input.trafficAllocation, 0), 100);
  const excluded = 100 - included;

  const raw = [input.controlWeight, ...input.variantWeights].map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const totalWeight = raw.reduce((sum, weight) => sum + weight, 0);

  const scaled =
    totalWeight > 0
      ? raw.map((weight) => (weight / totalWeight) * included)
      : raw.map(() => included / raw.length);

  const [control = 0, ...variants] = roundToTotal([...scaled, excluded], 100);

  return { control, variants: variants.slice(0, input.variantWeights.length), excluded };
}

/**
 * Scales `values` so they sum to exactly `target`, keeping every entry a whole number.
 *
 * Largest-remainder again, so the leftover point lands on the value with the strongest claim.
 * An all-zero input has no proportions to preserve, so it is split evenly — otherwise a set
 * that had been driven to zero could never take traffic back.
 */
function proportionally(values: number[], target: number): number[] {
  if (values.length === 0) return [];
  if (target <= 0) return values.map(() => 0);

  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  const scaled =
    total > 0
      ? values.map((value) => (Math.max(value, 0) / total) * target)
      : values.map(() => target / values.length);

  return roundToTotal(scaled, target);
}

/**
 * Sets one segment of a distribution to an exact value and rebalances the rest to total 100.
 *
 * **The typed value is kept exactly.** That is the whole point of this function, and the
 * reason it exists rather than the caller rescaling everything proportionally: doing that
 * rewrites the segments the customer typed a moment ago. With two arms it is invisible — the
 * single other segment simply absorbs the whole remainder, so the result is always exact —
 * but from three arms upward the change is smeared across the others and the earlier entries
 * visibly drift. Typing `25 / 25 / 20 / 30` used to store `26 / 25 / 19 / 30`.
 *
 * The change is taken from `absorbIndex` — the excluded slot — before any other segment,
 * because that is the one with no meaning of its own: it is whatever is left over. A set of
 * arm values that already totals 100 therefore leaves every arm exactly as typed, which is
 * what someone entering a planned split expects.
 *
 * Only when excluded runs out of room do the other arms give way, proportionally. That case
 * cannot be avoided — the total is fixed at 100 — but it is at least predictable.
 */
export function applyShare(
  percents: number[],
  index: number,
  value: number,
  absorbIndex: number,
): number[] {
  if (index < 0 || index >= percents.length) return [...percents];

  const next = Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100));
  const out = percents.map((percent) => Math.max(Math.round(percent), 0));
  out[index] = next;

  /** What every segment other than the edited one must now add up to. */
  const remaining = 100 - next;
  const donors = out.map((_, i) => i).filter((i) => i !== index);

  if (donors.length === 0) return out;

  // Editing the excluded slot itself has no separate absorber, so the arms take the change.
  if (index === absorbIndex || absorbIndex < 0 || absorbIndex >= out.length) {
    const scaled = proportionally(
      donors.map((i) => out[i]!),
      remaining,
    );
    donors.forEach((i, position) => (out[i] = scaled[position]!));
    return out;
  }

  const rest = donors.filter((i) => i !== absorbIndex);
  const restTotal = rest.reduce((sum, i) => sum + out[i]!, 0);

  // Excluded takes the whole change where it can, which is what keeps the other arms untouched.
  const absorbed = Math.min(Math.max(remaining - restTotal, 0), remaining);
  out[absorbIndex] = absorbed;

  const scaled = proportionally(
    rest.map((i) => out[i]!),
    remaining - absorbed,
  );
  rest.forEach((i, position) => (out[i] = scaled[position]!));

  return out;
}
