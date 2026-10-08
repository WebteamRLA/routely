import type { ArmConfig, LiveExperimentConfig } from "./contract";
import { type KeyValueStore, getSessionStorage } from "./env";
import { pageMatches } from "./targeting";
import { isSameUrl, readHandoff, withHandoff } from "./url";

type ExperimentConfig = LiveExperimentConfig;

/** The arms a visitor can be redirected to: every arm but control, with a URL. */
export function redirectArms(
  experiment: ExperimentConfig,
): (ArmConfig & { variantId: string; url: string })[] {
  return experiment.arms.filter(
    (arm): arm is ArmConfig & { variantId: string; url: string } =>
      arm.variantId !== null && typeof arm.url === "string",
  );
}

/**
 * Deciding whether — and where — to redirect.
 *
 * A redirect loop on a customer's site is the worst failure this SDK can produce: it makes
 * the page unreachable, it is invisible in testing if the developer's own browser has already
 * been bucketed, and it burns the customer's traffic. So the guards are layered, and each one
 * would be sufficient on its own for the case it covers.
 */

const REDIRECTED_PREFIX = "routely_r_";

/** Ceiling on redirects for one experiment within a single tab session. */
const MAX_REDIRECTS_PER_SESSION = 1;

export type SkipReason =
  | "no-match"
  | "excluded"
  | "already-on-variant"
  | "arrived-by-redirect"
  | "already-redirected"
  | "same-url";

export type RedirectDecision =
  | { action: "stay"; experiment: ExperimentConfig; variantId: null }
  | { action: "redirect"; experiment: ExperimentConfig; variantId: string; target: string }
  | { action: "skip"; experiment: ExperimentConfig; reason: SkipReason };

export function redirectedKey(experimentId: string): string {
  return REDIRECTED_PREFIX + experimentId;
}

/** Session-scoped, because a new tab is a new chance to be redirected but a reload is not. */
export function countRedirects(experimentId: string, store: KeyValueStore | null): number {
  if (!store) return 0;
  try {
    return Number(store.getItem(redirectedKey(experimentId))) || 0;
  } catch {
    return 0;
  }
}

export function recordRedirect(experimentId: string, store: KeyValueStore | null): void {
  if (!store) return;
  try {
    const next = countRedirects(experimentId, store) + 1;
    store.setItem(redirectedKey(experimentId), String(next));
  } catch {
    // Losing the counter costs a guard, not correctness — three others remain.
  }
}

/**
 * Finds the active experiment that claims the current page.
 *
 * Only the experiment's **page rule** is matched — by default the control URL. A variant is
 * never a trigger in its own right, which is the first reason a variant page cannot start the
 * cycle again; a broad rule (`contains`, `PREFIX`) that also covers a variant is caught by the
 * already-on-variant guard below.
 */
export function findExperimentForUrl(
  href: string,
  experiments: ExperimentConfig[],
): ExperimentConfig | null {
  for (const experiment of experiments) {
    if (pageMatches(experiment.targeting, href)) {
      return experiment;
    }
  }
  return null;
}

/**
 * Decides what to do on this page load.
 *
 * Checked first, before any of the four loop guards below: **traffic allocation.** A visitor
 * `includedFor` finds not part of the experiment is skipped immediately — no arm is drawn, so
 * no assignment is ever created for them, and nothing about them is reported.
 *
 * The four loop guards, in the order they are checked:
 *
 *  1. **Already on a variant.** With `PREFIX` matching a variant can sit underneath its own
 *     control — `/pricing` claiming `/pricing/v2` — so matching the control is not enough to
 *     prove this is the control page. Checked against every variant, not just one.
 *  2. **Arrived by redirect.** The handoff parameters in the URL say this page load *is* the
 *     result of this experiment's redirect. Survives a reload of the variant page, and works
 *     across origins where storage does not.
 *  3. **Already redirected this session.** A counter in `sessionStorage`, incremented before
 *     the redirect is issued, so even a decision that somehow repeats cannot bounce twice.
 *  4. **Target equals current URL.** The last resort: whatever the configuration says, never
 *     navigate to the page already being displayed.
 */
export function decide(
  href: string,
  experiments: ExperimentConfig[],
  variantFor: (experiment: ExperimentConfig) => string | null,
  context: { visitorId: string; sessionStore?: KeyValueStore | null },
  includedFor: (experiment: ExperimentConfig) => boolean = () => true,
): RedirectDecision | null {
  const experiment = findExperimentForUrl(href, experiments);
  if (!experiment) return null;

  if (!includedFor(experiment)) {
    return { action: "skip", experiment, reason: "excluded" };
  }

  const variants = redirectArms(experiment);

  if (variants.some((variant) => isSameUrl(href, variant.url))) {
    return { action: "skip", experiment, reason: "already-on-variant" };
  }

  const handoff = readHandoff(href);
  if (handoff && handoff.experimentId === experiment.id) {
    return { action: "skip", experiment, reason: "arrived-by-redirect" };
  }

  const sessionStore =
    context.sessionStore === undefined ? getSessionStorage() : context.sessionStore;
  if (countRedirects(experiment.id, sessionStore) >= MAX_REDIRECTS_PER_SESSION) {
    return { action: "skip", experiment, reason: "already-redirected" };
  }

  const variantId = variantFor(experiment);
  const targetVariant = variantId === null ? null : variants.find((v) => v.variantId === variantId);

  // A non-null variantId that matches nothing in this experiment's own variant list would be
  // a corrupted or stale assignment (never possible from a correctly-behaving caller, since a
  // live experiment's variant set is immutable once active) — the safe response is to treat it
  // as control rather than redirect to an undefined target.
  if (variantId === null || !targetVariant) {
    return { action: "stay", experiment, variantId: null };
  }

  const target = withHandoff(targetVariant.url, {
    visitorId: context.visitorId,
    experimentId: experiment.id,
    variant: targetVariant.variantId,
  });

  if (isSameUrl(target, href)) {
    return { action: "skip", experiment, reason: "same-url" };
  }

  return { action: "redirect", experiment, variantId: targetVariant.variantId, target };
}

/**
 * Performs the navigation.
 *
 * `location.replace` rather than `assign`: the control page is removed from history, so the
 * browser's Back button returns the visitor to wherever they came from instead of landing them
 * on the control page and immediately redirecting them forward again.
 *
 * The session counter is incremented *before* navigating, so the guard is already in place if
 * the destination somehow re-enters this code.
 */
export function performRedirect(
  target: string,
  experimentId: string,
  sessionStore: KeyValueStore | null = getSessionStorage(),
): void {
  recordRedirect(experimentId, sessionStore);

  try {
    window.location.replace(target);
  } catch {
    // A blocked navigation leaves the visitor on the control page, which is the safe outcome.
  }
}
