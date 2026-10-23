import type { ExperimentConfig } from "./contract";
import { type KeyValueStore, getSessionStorage } from "./env";
import { isSameUrl, readHandoff, urlMatches, withHandoff } from "./url";

/**
 * Deciding whether — and where — to redirect.
 *
 * A redirect loop on a customer's site is the worst failure this SDK can produce: it makes
 * the page unreachable, it is invisible in testing if the developer's own browser has already
 * been bucketed, and it burns the customer's traffic. So the guards are layered, and each one
 * would be sufficient on its own for the case it covers.
 */

const REDIRECTED_PREFIX = "routely_r_";

/**
 * How long a redirect counts as "still on its way". A redirect that has not landed on its
 * variant within this window — the variant URL bounced the visitor straight back to the control —
 * is a loop, and the control page does not redirect again until the window passes.
 */
export const REDIRECT_PENDING_MS = 30_000;

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

/**
 * A redirect for this experiment was issued and has not landed yet, within the last
 * `REDIRECT_PENDING_MS`. Session-scoped (`sessionStorage`), so it is per tab.
 *
 * It used to be a plain counter capped at one redirect per tab session — which also stopped a
 * visitor who had *landed* on their variant from being sent there again when they came back to
 * the control page: they saw the control while every event was reported for their variant. Now
 * only a redirect that never arrived blocks another. (A value from the old counter, e.g. `"1"`,
 * reads as a timestamp in 1970 and so as long expired.)
 */
export function isRedirectPending(
  experimentId: string,
  store: KeyValueStore | null,
  now: number = Date.now(),
): boolean {
  if (!store) return false;
  try {
    const at = Number(store.getItem(redirectedKey(experimentId)));
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < REDIRECT_PENDING_MS;
  } catch {
    return false;
  }
}

/** Marks a redirect as issued, before navigating. */
export function recordRedirect(
  experimentId: string,
  store: KeyValueStore | null,
  now: number = Date.now(),
): void {
  if (!store) return;
  try {
    store.setItem(redirectedKey(experimentId), String(now));
  } catch {
    // Losing the marker costs a guard, not correctness — three others remain.
  }
}

/**
 * Clears the pending marker of every experiment whose variant this page is (or whose redirect
 * brought the visitor here): the redirect landed, so a later visit to the control may redirect
 * again. Only same-origin variants can clear it — storage is per origin — so a cross-origin
 * variant blocks a revisit for at most `REDIRECT_PENDING_MS`.
 */
export function markLanded(
  href: string,
  experiments: ExperimentConfig[],
  store: KeyValueStore | null,
): void {
  if (!store) return;
  const handoff = readHandoff(href);
  for (const experiment of experiments) {
    const onVariant =
      (handoff && handoff.experimentId === experiment.id) ||
      experiment.variants.some((variant) => variant.url && isSameUrl(href, String(variant.url)));
    if (!onVariant) continue;
    try {
      store.removeItem(redirectedKey(experiment.id));
    } catch {
      // Nothing to clear.
    }
  }
}

/**
 * Finds the active experiment that claims the current page.
 *
 * Only the **control** URL is matched. A variant is never a trigger, which is the first and
 * most important reason a variant page cannot start the cycle again.
 */
export function findExperimentForUrl(
  href: string,
  experiments: ExperimentConfig[],
): ExperimentConfig | null {
  for (const experiment of experiments) {
    if (urlMatches(href, experiment.control.url, experiment.control.match)) {
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
 *  3. **A redirect still pending.** A timestamp in `sessionStorage`, written before the redirect
 *     is issued and cleared when the visitor lands on the variant (`markLanded`). Back on the
 *     control page with it still set — within `REDIRECT_PENDING_MS` — the redirect never landed
 *     (the variant bounced back), so it is not repeated.
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

  if (
    experiment.variants.some(
      (variant) =>
        isSameUrl(href, String(variant.url)) ||
        // With `keepParams` the variant page carries the visitor's own parameters too, so it is
        // compared as it would look after a redirect from here.
        (experiment.keepParams === true && isSameUrl(href, carryParams(String(variant.url), href))),
    )
  ) {
    return { action: "skip", experiment, reason: "already-on-variant" };
  }

  const handoff = readHandoff(href);
  if (handoff && handoff.experimentId === experiment.id) {
    return { action: "skip", experiment, reason: "arrived-by-redirect" };
  }

  const sessionStore =
    context.sessionStore === undefined ? getSessionStorage() : context.sessionStore;
  if (isRedirectPending(experiment.id, sessionStore)) {
    return { action: "skip", experiment, reason: "already-redirected" };
  }

  const variantId = variantFor(experiment);
  const targetVariant =
    variantId === null ? null : experiment.variants.find((v) => v.id === variantId);

  // A non-null variantId that matches nothing in this experiment's own variant list would be
  // a corrupted or stale assignment (never possible from a correctly-behaving caller, since a
  // live experiment's variant set is immutable once active) — the safe response is to treat it
  // as control rather than redirect to an undefined target.
  if (variantId === null || !targetVariant) {
    return { action: "stay", experiment, variantId: null };
  }

  const destination = String(targetVariant.url);
  const target = withHandoff(experiment.keepParams ? carryParams(destination, href) : destination, {
    visitorId: context.visitorId,
    experimentId: experiment.id,
    variant: targetVariant.id,
  });

  if (isSameUrl(target, href)) {
    return { action: "skip", experiment, reason: "same-url" };
  }

  return { action: "redirect", experiment, variantId: targetVariant.id, target };
}

/**
 * The variant URL with the visitor's own query parameters and fragment carried over.
 *
 * The target's own parameters win on a clash — the customer configured them, so they are part
 * of what the variant *is* — and Routely's handoff parameters are never carried, because the
 * redirect writes fresh ones. The fragment is carried only when the target has none.
 *
 * Without this, a visitor arriving on `/pricing?utm_source=ads&plan=pro` lands on
 * `/pricing-v2` with the campaign attribution and the page state both gone.
 */
export function carryParams(target: string, current: string): string {
  try {
    const to = new URL(target);
    const from = new URL(current);

    from.searchParams.forEach((value, key) => {
      if (key.indexOf("_rt_") !== 0 && !to.searchParams.has(key))
        to.searchParams.append(key, value);
    });
    if (!to.hash && from.hash) to.hash = from.hash;

    return to.toString();
  } catch {
    return target;
  }
}

/**
 * Performs the navigation.
 *
 * `location.replace` rather than `assign`: the control page is removed from history, so the
 * browser's Back button returns the visitor to wherever they came from instead of landing them
 * on the control page and immediately redirecting them forward again.
 *
 * The pending marker is written *before* navigating, so the guard is already in place if the
 * destination bounces straight back to this page.
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
