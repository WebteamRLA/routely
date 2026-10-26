import type { AssignRequest, AssignResponse } from "./contract";
import { SDK_PROTOCOL_VERSION } from "./contract";
import { type KeyValueStore, createMemoryStore, getLocalStorage } from "./env";
import { getJson } from "./transport";

/**
 * Which arm of an experiment a visitor belongs to.
 *
 * The arm is chosen **by the server**, once (`POST /api/v1/assign`): only there are the other
 * visitors' assignments visible, and the split is balanced against them — 25 visitors across five
 * equal versions are 5 each, not whatever a coin happened to give. It is then persisted here, and
 * persistence is what makes the experience consistent: every later page load reads the stored arm
 * and asks nothing, so a refresh, a return visit or a second tab all see the same version and none
 * of them counts as a new visitor.
 *
 * The browser never guesses. If the server cannot be asked — offline, slow, blocked — the visitor
 * is simply not entered on that page load and sees the page as it is; the next page load asks
 * again. A guess would put them in an arm the server never balanced or recorded.
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
 * The visitor's arm without asking anyone: the stored one, or — on a fresh origin after a
 * redirect — the one `forced` carries in the URL, which is then stored. Undefined when neither.
 *
 * `forced` is applied only when nothing is stored: a value from a query string is
 * attacker-controllable, so it may seed an origin that has no assignment yet but never overwrite
 * one. `undefined` (not `null`) means "no forced value" — `null` is itself an arm (control).
 */
export function knownAssignment(
  experimentId: string,
  stores: KeyValueStore[],
  forced?: string | null,
): string | null | undefined {
  const existing = readAssignment(experimentId, stores);
  if (existing) return existing.variantId;
  if (forced === undefined) return undefined;
  writeAssignment(experimentId, { variantId: forced, at: Date.now(), sent: false }, stores);
  return forced;
}

/** Asks the server for this visitor's arm (`AssignRequest`). Null: not entered. */
export function requestAssignment(
  apiBase: string,
  request: Omit<AssignRequest, "v">,
  timeoutMs?: number,
): Promise<AssignResponse | null> {
  return getJson<AssignResponse>(
    apiBase + "/api/v1/assign",
    timeoutMs,
    JSON.stringify({ v: SDK_PROTOCOL_VERSION, ...request }),
  );
}

/**
 * The visitor's arm: the stored one if there is one (no request — this is every refresh and every
 * return visit), otherwise the server's answer, stored as already recorded (`sent`), since the
 * server wrote the assignment when it chose it. Undefined when the server did not enter them.
 */
export async function obtainAssignment(
  experimentId: string,
  stores: KeyValueStore[],
  ask: () => Promise<AssignResponse | null>,
): Promise<string | null | undefined> {
  const known = knownAssignment(experimentId, stores);
  if (known !== undefined) return known;

  const answer = await ask();
  const variantId = answer ? answer.variantId : undefined;
  if (variantId !== null && typeof variantId !== "string") return undefined;
  writeAssignment(experimentId, { variantId, at: Date.now(), sent: true }, stores);
  return variantId;
}

/** Marks an assignment as acknowledged by the backend so it is not reported repeatedly. */
export function markAssignmentSent(experimentId: string, stores: KeyValueStore[]): void {
  const existing = readAssignment(experimentId, stores);
  if (!existing || existing.sent) return;
  writeAssignment(experimentId, { ...existing, sent: true }, stores);
}
