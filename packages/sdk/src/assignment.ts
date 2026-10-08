import type { LiveExperimentConfig } from "./contract";
import { type KeyValueStore, createMemoryStore, getLocalStorage } from "./env";

/**
 * Which arm of an experiment a visitor belongs to.
 *
 * The assignment is made **once**, at random, and then persisted. Persistence — not the
 * randomness — is what makes the experience consistent: on every later page load the stored
 * value is read rather than a new draw being made, so a refresh, a return visit or a second
 * tab all see the same version. A visitor who saw a variant yesterday sees it today.
 */

const KEY_PREFIX = "routely_a_";

/** Stored per experiment rather than as one blob, so an experiment can be forgotten alone. */
export function assignmentKey(experimentId: string): string {
  return KEY_PREFIX + experimentId;
}

export interface StoredAssignment {
  /** `null` is control; a non-null value is the variant's id. */
  variantId: string | null;
  /** Epoch milliseconds, for diagnostics — never used to expire an assignment. */
  at: number;
  /** True once the backend has acknowledged it, so a failed report can be retried. */
  sent: boolean;
}

function isStoredAssignment(value: unknown): value is StoredAssignment {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredAssignment>;
  return candidate.variantId === null || typeof candidate.variantId === "string";
}

/**
 * The stores an assignment is kept in.
 *
 * `localStorage` only: unlike the visitor id, an assignment is not worth a cookie on every
 * request to the customer's own server, and the memory fallback keeps the SDK working for the
 * duration of a page load when storage is denied.
 */
export function resolveAssignmentStores(): KeyValueStore[] {
  const stores: KeyValueStore[] = [];
  const local = getLocalStorage();
  if (local) stores.push(local);
  stores.push(createMemoryStore());
  return stores;
}

export function readAssignment(
  experimentId: string,
  stores: KeyValueStore[],
): StoredAssignment | null {
  for (const store of stores) {
    try {
      const raw = store.getItem(assignmentKey(experimentId));
      if (!raw) continue;

      const parsed: unknown = JSON.parse(raw);
      if (isStoredAssignment(parsed)) return parsed;
    } catch {
      // A corrupted or inaccessible entry is treated as absent, not fatal.
    }
  }
  return null;
}

export function writeAssignment(
  experimentId: string,
  assignment: StoredAssignment,
  stores: KeyValueStore[],
): void {
  const raw = JSON.stringify(assignment);

  for (const store of stores) {
    try {
      store.setItem(assignmentKey(experimentId), raw);
    } catch {
      // A full or read-only store is not a reason to stop trying the others.
    }
  }
}

/**
 * Draws an arm for a visitor who has none, weighted by each arm's share.
 *
 * Weights are **relative**, not percentages: they are summed and the draw lands proportionally,
 * so `50/50` and `1/1` mean the same thing and no caller has to make them add to 100. An arm
 * weighted `0` is simply never drawn, which is what parking an arm means.
 *
 * The draw is a plain weighted random rather than a hash of the visitor id: with the result
 * persisted, hashing would buy nothing except an inability to re-weight later without
 * re-bucketing everyone who had already been assigned.
 *
 * A non-finite or negative weight is treated as `0`, and a set that sums to `0` falls back to
 * control — a configuration that can't be drawn from must not throw inside a tracking script.
 */
export function drawArm(
  controlWeight: number,
  variants: { id: string; weight: number }[],
  random: () => number = Math.random,
): string | null {
  const clean = (weight: number) => (Number.isFinite(weight) && weight > 0 ? weight : 0);

  const control = clean(controlWeight);
  const weights = variants.map((variant) => clean(variant.weight));
  const total = weights.reduce((sum, weight) => sum + weight, control);

  if (total <= 0) return null;

  // `random()` is [0, 1), so `roll` lands inside one of the ranges below. A source that
  // returns exactly 1 — or a float rounding at the very top of the range — falls past the
  // last range instead, so the tail below hands it to the last arm that can actually be
  // drawn rather than wrapping it back to control.
  let roll = random() * total;

  if (roll < control) return null;
  roll -= control;

  for (const [index, weight] of weights.entries()) {
    if (roll < weight) return variants[index]!.id;
    roll -= weight;
  }

  for (let index = weights.length - 1; index >= 0; index -= 1) {
    if (weights[index]! > 0) return variants[index]!.id;
  }

  return null;
}

export interface AssignmentResult {
  variantId: string | null;
  /** True when this page load made the decision, rather than reading a stored one. */
  isNew: boolean;
}

/**
 * Returns the visitor's arm for an experiment, drawing and persisting one only if absent.
 *
 * `forced` carries a decision handed over in the URL after a redirect. It is applied only when
 * nothing is stored: a value from a query string is attacker-controllable, so it may seed a new
 * assignment on a fresh origin but must never overwrite one already made. Distinguished from
 * "no forced value" by `undefined` rather than `null`, because `null` is itself a meaningful
 * forced value now (forced to control) — unlike the old two-arm model, where "not forced" and
 * "forced to control" could share one falsy sentinel.
 */
export function resolveAssignment(
  experiment: Pick<LiveExperimentConfig, "id" | "arms">,
  stores: KeyValueStore[],
  options: { forced?: string | null; random?: () => number; now?: number } = {},
): AssignmentResult {
  const existing = readAssignment(experiment.id, stores);
  if (existing) return { variantId: existing.variantId, isNew: false };

  let controlWeight = 0;
  const variants: { id: string; weight: number }[] = [];
  for (const arm of experiment.arms) {
    if (arm.variantId === null) controlWeight = arm.weight;
    else variants.push({ id: arm.variantId, weight: arm.weight });
  }

  const variantId =
    options.forced !== undefined
      ? options.forced
      : drawArm(controlWeight, variants, options.random);

  writeAssignment(experiment.id, { variantId, at: options.now ?? Date.now(), sent: false }, stores);

  return { variantId, isNew: true };
}

/** Marks an assignment as acknowledged by the backend so it is not reported repeatedly. */
export function markAssignmentSent(experimentId: string, stores: KeyValueStore[]): void {
  const existing = readAssignment(experimentId, stores);
  if (!existing || existing.sent) return;
  writeAssignment(experimentId, { ...existing, sent: true }, stores);
}
