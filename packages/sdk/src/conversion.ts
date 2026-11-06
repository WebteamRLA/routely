import type { ExperimentConfig } from "./contract";
import { type KeyValueStore, getLocalStorage } from "./env";
import { urlMatches } from "./url";

/**
 * URL-based conversion goals.
 *
 * A conversion is a visitor who was in an experiment reaching the page the experiment counts
 * as success — typically a thank-you or order-confirmation page. Two conditions, both
 * required:
 *
 *  1. The current page matches the experiment's configured conversion URL.
 *  2. The visitor **already has an assignment** for that experiment.
 *
 * The second is what makes the number mean anything. Someone who reaches `/thank-you` without
 * ever having been bucketed did not convert *in this experiment* — they arrived by some other
 * path, and counting them would credit the experiment for traffic it never touched.
 */

const KEY_PREFIX = "routely_cv_";

/** Guards against a second copy of the SDK on the same page load. */
const claimedInThisInstance = new Set<string>();

export function conversionKey(experimentId: string): string {
  return KEY_PREFIX + experimentId;
}

/**
 * Every active experiment whose goal this page satisfies.
 *
 * Returns a list rather than the first match: two experiments on the same website can share a
 * conversion page — a pricing test and a checkout test both ending at `/thank-you` — and each
 * deserves its own conversion for the visitors it actually bucketed.
 */
export function findGoalMatches(href: string, experiments: ExperimentConfig[]): ExperimentConfig[] {
  return experiments.filter(({ goal }) => goal !== null && urlMatches(href, goal.url, goal.match));
}

/**
 * Claims the one conversion this visitor may record for an experiment.
 *
 * Returns true the first time, false ever after. The marker lives in `localStorage` rather
 * than `sessionStorage` and never expires, because a conversion is once per assignment for the
 * lifetime of the experiment — not once per session. Refreshing the thank-you page, returning
 * to it tomorrow, or opening it in a second tab must all be silent.
 *
 * This is the cheap first line. The server's unique constraint on `assignmentId` is the one
 * that actually guarantees it, because the client is exactly what cannot be trusted to have
 * asked only once.
 */
export function claimConversion(
  experimentId: string,
  store: KeyValueStore | null = getLocalStorage(),
  now: number = Date.now(),
): boolean {
  if (claimedInThisInstance.has(experimentId)) return false;

  if (store) {
    try {
      if (store.getItem(conversionKey(experimentId))) {
        claimedInThisInstance.add(experimentId);
        return false;
      }
      store.setItem(conversionKey(experimentId), String(now));
    } catch {
      // Without storage the in-instance guard still prevents the common double-init case.
    }
  }

  claimedInThisInstance.add(experimentId);
  return true;
}

/** Test seam: forget what has been claimed in this instance. */
export function resetConversionGuard(): void {
  claimedInThisInstance.clear();
}
