/**
 * Balanced traffic allocation: which arm a **new** visitor to an experiment is put in.
 *
 * A weighted random draw is fair only on average. On a small sample it is lumpy — 25 visitors
 * across five equal arms routinely come out 9/6/4/4/2 — and an early result read off a lumpy split
 * compares arms that were never given the same chance. So the arm is not drawn; it is **owed**.
 * After `n` visitors an arm with share `s` should hold `s × n` of them; each new visitor goes to the
 * arm furthest below that (`expected − actual`, its *deficit*), ties broken at random. The counts
 * then never stray more than one visitor from the configured split, at every point in the
 * experiment: 25 visitors over five equal arms are exactly 5 each, and 50/20/10/10/10 over ten
 * visitors is exactly 5/2/1/1/1.
 *
 * `actual` is the real number of assignments, so the allocation also corrects an imbalance it did
 * not cause (assignments recorded by an older client that drew arms itself): the under-filled arm is
 * owed visitors until it catches up.
 *
 * Only *new* visitors are allocated. A visitor who already has an arm keeps it for the life of the
 * experiment (`assignVisitor` returns the stored one), so refreshing, returning or opening a second
 * tab never moves a visitor and never adds one.
 *
 * Traffic balancing decides who *sees* what; it says nothing about which arm is *better*. That is
 * `lib/verdict.ts`, which reads the resulting counts and names nothing until every arm has enough
 * data. Neither module imports the other.
 */

/** One arm and its tally. `id` null is the control arm. */
export interface ArmTally {
  id: string | null;
  /** Relative weight (`controlWeight` / `ExperimentVariant.weight`): `50/50` ≡ `1/1`. */
  weight: number;
  /** Visitors already assigned to this arm. */
  count: number;
}

const clean = (weight: number) => (Number.isFinite(weight) && weight > 0 ? weight : 0);

/** Floating-point slack when comparing deficits, so equal shares tie exactly. */
const EPSILON = 1e-9;

/**
 * The arm the next new visitor belongs to: the largest deficit against the configured shares,
 * a random choice among equal deficits. An arm weighted `0` is never chosen (that is what parking
 * an arm means); a set that weighs nothing at all falls back to control, as the SDK always has.
 */
export function pickBalancedArm(
  arms: readonly ArmTally[],
  random: () => number = Math.random,
): string | null {
  const total = arms.reduce((sum, arm) => sum + clean(arm.weight), 0);
  if (total <= 0) return null;

  const next = arms.reduce((sum, arm) => sum + Math.max(0, arm.count), 0) + 1;
  let best: ArmTally[] = [];
  let bestDeficit = -Infinity;
  for (const arm of arms) {
    const weight = clean(arm.weight);
    if (weight === 0) continue;
    const deficit = (weight / total) * next - Math.max(0, arm.count);
    if (deficit > bestDeficit + EPSILON) {
      best = [arm];
      bestDeficit = deficit;
    } else if (Math.abs(deficit - bestDeficit) <= EPSILON) {
      best.push(arm);
    }
  }

  const index = Math.min(best.length - 1, Math.floor(random() * best.length));
  return best[index]!.id;
}

// --- Assigning under a lock -------------------------------------------------------------------

/** What one experiment's assignments look like inside the allocation transaction. */
export interface LedgerTx {
  /** The visitor's existing arm in this experiment, or undefined when they have none. */
  existing(visitorId: string): Promise<{ variantId: string | null } | undefined>;
  /** Assignments per arm (`null` = control). Arms with none may be missing. */
  counts(): Promise<Map<string | null, number>>;
  create(visitorId: string, variantId: string | null): Promise<void>;
}

/**
 * Runs `fn` with this experiment's allocation **serialised**: no other allocation for the same
 * experiment may read the counts until `fn` has written its row (in Postgres, a transaction holding
 * `pg_advisory_xact_lock`). Without it, two visitors arriving together read the same counts, are
 * owed the same arm, and the split drifts by one per collision.
 */
export interface AssignmentLedger {
  serialised<T>(experimentId: string, fn: (tx: LedgerTx) => Promise<T>): Promise<T>;
}

export interface AllocatableExperiment {
  id: string;
  controlWeight: number;
  variants: readonly { id: string; weight: number }[];
}

export interface AssignOutcome {
  variantId: string | null;
  /** False when the visitor already had this arm — nothing was written. */
  created: boolean;
}

/**
 * The visitor's arm in `experiment`: their existing one, or a balanced new one, recorded.
 *
 * Idempotent per visitor: asking again — a refresh, a second tab, a retried request, two requests
 * racing — returns the same arm and writes nothing more. The visitors per arm (one assignment row
 * each, unique on experiment and visitor) are exactly what the dashboard counts.
 */
export async function assignVisitor(
  ledger: AssignmentLedger,
  experiment: AllocatableExperiment,
  visitorId: string,
  random: () => number = Math.random,
): Promise<AssignOutcome> {
  return ledger.serialised(experiment.id, async (tx) => {
    const existing = await tx.existing(visitorId);
    if (existing) return { variantId: existing.variantId, created: false };

    const counts = await tx.counts();
    const variantId = pickBalancedArm(
      [
        { id: null, weight: experiment.controlWeight, count: counts.get(null) ?? 0 },
        ...experiment.variants.map((variant) => ({
          id: variant.id,
          weight: variant.weight,
          count: counts.get(variant.id) ?? 0,
        })),
      ],
      random,
    );
    await tx.create(visitorId, variantId);
    return { variantId, created: true };
  });
}
