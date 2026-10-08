/**
 * Routely tracking SDK.
 *
 * A dependency-free browser bundle installed with a single tag:
 *
 *   <script src="https://cdn.example.com/sdk.js" data-site-id="rt_abc123"></script>
 *
 * It is framework-independent because it asks nothing of the host page beyond a `<script>`
 * element — no bundler, no npm package, no lifecycle to hook into. That is what makes the same
 * file work on WordPress, WooCommerce, React, Next.js and hand-written HTML.
 *
 * Three properties govern everything here:
 *
 *  1. **It never breaks the page.** Every failure path — no storage, no network, a malformed
 *     response, a blocked request — ends with the SDK doing nothing. Nothing throws into the
 *     host page, and no promise is left to reject unhandled.
 *  2. **It never blocks the page.** The tag is loaded synchronously so a future redirect can
 *     be decided before paint, but the work itself is asynchronous: reading identity is
 *     microseconds, and the configuration request never gates rendering.
 *  3. **It carries no secret.** The only credential-shaped thing it knows is the public site
 *     id, which is visible in page source by design and permits nothing beyond recording
 *     activity for one website.
 *
 */

import { drainQueue, isTrackKey, runCommand } from "./api";
import {
  markAssignmentSent,
  readAssignment,
  resolveAssignment,
  resolveAssignmentStores,
} from "./assignment";
import { applyWhenReady } from "./changes";
import { revealPage } from "./cloak";
import { loadConfig } from "./config";
import { claimPageView } from "./dedupe";
import {
  type EngagementTimer,
  MIN_FLUSH_MS,
  attachEngagement,
  createEngagementTimer,
} from "./engagement";
import { getSessionStorage } from "./env";
import { SDK_PROTOCOL_VERSION } from "./contract";
import type {
  ChangeConfig,
  ConfigResponse,
  LiveExperimentConfig,
  LockedExperimentConfig,
  TrackedEvent,
} from "./contract";
import { type Identity, resolveIdentity } from "./identity";
import { resolveInclusion } from "./inclusion";
import { type Preview, readPreview, withPreview, withoutPreview } from "./preview";
import { decide, performRedirect } from "./redirect";
import { type VisitContext, detectDevice, isBotAgent, isTargeted, pageMatches } from "./targeting";
import { pageEvents, sendEvents } from "./track";
import { DEFAULT_TIMEOUT_MS } from "./transport";
import { isSameUrl, normalizeUrl, readHandoff, stripHandoff } from "./url";

export * from "./contract";
export { resolveIdentity, isValidVisitorId } from "./identity";
export { loadConfig, isConfigResponse } from "./config";
export { resolveAssignment, drawArm, readAssignment } from "./assignment";
export { resolveInclusion, readInclusion } from "./inclusion";
export { decide, findExperimentForUrl } from "./redirect";
export { normalizeUrl, urlMatches, isSameUrl, withHandoff, readHandoff } from "./url";
export { claimPageView } from "./dedupe";
export { revealPage } from "./cloak";
export { createEngagementTimer, attachEngagement } from "./engagement";
export { matches, pageMatches, isTargeted, detectDevice } from "./targeting";
export { applyChange, applyToElement } from "./changes";
export { readPreview } from "./preview";

export const SDK_VERSION = "0.2.0";

/** Replaced at build time by esbuild's `define`. */
declare const __ROUTELY_API_BASE__: string;

/** Options read from `data-*` attributes on the loading `<script>` tag. */
export interface RoutelyOptions {
  /** Public site id, e.g. `rt_abc123`. Required. Identifies a website, never a person. */
  siteId: string;
  /** API origin. Defaults to the value baked in at build time. */
  apiBase: string;
  /** How long to wait for the configuration request before giving up. */
  timeoutMs: number;
  /** Log what the SDK is doing. Enabled with `data-debug="true"`. */
  debug: boolean;
}

/** One experiment this page load takes part in. */
export interface Participation {
  experimentId: string;
  /** `null` is control. */
  variantId: string | null;
}

/**
 * `window.routely`: the public API plus what the SDK did, for debugging an installation.
 * Installed synchronously, before the configuration request, so `track` works immediately.
 */
export interface RoutelyState {
  version: string;
  protocol: number;
  siteId: string;
  visitorId: string;
  identitySource: Identity["source"];
  experiments: ConfigResponse["experiments"];
  /** True when the configuration could not be loaded — the SDK then does nothing. */
  degraded: boolean;
  /** The first experiment this page takes part in (kept for v3-era debugging habits). */
  assignment: Participation | null;
  /** Every experiment this page takes part in. */
  assignments: Participation[];
  /** What the SDK did on this page load. */
  action: "none" | "stay" | "apply" | "redirect" | "skip";
  /** True when this page load handed events to the browser for delivery. */
  reported: boolean;
  /** Set when this page load is a preview: an arm is forced and nothing is reported. */
  preview: Preview | null;
  /** The visible-time accumulator, exposed for debugging an installation. */
  engagement?: EngagementTimer;
  /** Sends a custom event. Returns whether the browser accepted it for delivery. */
  track(key: string): boolean;
  /** Queue-compatible entry point: `routely.push(["track", key])`. */
  push(entry: unknown): void;
}

declare global {
  interface Window {
    routely?: RoutelyState;
  }
}

/**
 * Reads options from the `<script>` element that loaded this bundle.
 *
 * Returns `null` when the snippet carries no site id — the signal to do nothing at all. A
 * mis-pasted snippet must never break the page it was pasted into.
 */
export function readOptions(script: HTMLScriptElement | null): RoutelyOptions | null {
  const siteId = script?.dataset.siteId?.trim();
  if (!siteId) return null;

  const timeout = Number(script?.dataset.timeout);

  return {
    siteId,
    apiBase: (script?.dataset.api || __ROUTELY_API_BASE__).replace(/\/+$/, ""),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    debug: script?.dataset.debug === "true",
  };
}

/**
 * Finds the script tag that loaded this bundle.
 *
 * `document.currentScript` is correct and cheap, but it is null when the bundle is loaded
 * asynchronously or injected by a tag manager — both common on the sites this runs on — so
 * there is a fallback that looks for any script carrying a site id.
 */
export function findScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.dataset?.siteId) return current;

  return document.querySelector<HTMLScriptElement>("script[data-site-id]");
}

/** The current page, normalised the way the server will store it. */
function currentUrl(): string {
  const href = window.location.href;
  return normalizeUrl(href) ?? href;
}

/**
 * Starts the SDK. Resolves to the resulting state, or `null` when there was nothing to do.
 *
 * Deliberately `async` and un-awaited by the bundle's entry call: the host page continues
 * rendering while the configuration request is in flight.
 */
export async function boot(): Promise<RoutelyState | null> {
  const options = readOptions(findScript());
  if (!options) return null;

  const log = options.debug
    ? // eslint-disable-next-line no-console
      (...args: unknown[]) => console.info("[routely]", ...args)
    : () => {};

  // The handoff is read before anything else: it may carry the visitor id from the origin
  // that redirected here, and identity must be resolved with that in hand.
  const href = window.location.href;
  const handoff = readHandoff(href);
  const preview = readPreview(href);

  // Identity is resolved synchronously: it depends on nothing external, so it is available
  // even when the network is not.
  const identity = resolveIdentity(undefined, { preferred: handoff?.visitorId });
  log(`visitor ${identity.id} (${identity.isNew ? "new" : "returning"}, ${identity.source})`);

  // Tidied unconditionally, and early: the parameters have served their purpose by now, and
  // leaving them in the address bar means they get bookmarked, shared, and reported to the
  // customer's own analytics as though they were campaign parameters.
  cleanUrl(href);

  // A crawler sees the control page and is never reported: no redirect, no change, no event.
  const bot = isBotAgent(typeof navigator !== "undefined" ? navigator.userAgent || "" : "");

  const send = (events: TrackedEvent[]) =>
    // A preview reports nothing at all — not a page view, not a custom event.
    !preview && !bot && sendEvents(options.apiBase, options.siteId, identity.id, events);

  const track = (key: unknown): boolean => {
    try {
      if (!isTrackKey(key)) return false;
      log(`track ${key}`);
      return send([{ type: "track", key, url: currentUrl(), ts: Date.now() }]);
    } catch {
      return false;
    }
  };

  const queued = typeof window !== "undefined" ? window.routely : undefined;

  const state: RoutelyState = {
    version: SDK_VERSION,
    protocol: SDK_PROTOCOL_VERSION,
    siteId: options.siteId,
    visitorId: identity.id,
    identitySource: identity.source,
    experiments: [],
    degraded: false,
    assignment: null,
    assignments: [],
    action: "none",
    reported: false,
    preview,
    track,
    push: (entry) => runCommand(entry, track),
  };

  // Installed before the configuration request: custom events need no configuration — the
  // server matches them against the project's metrics — so they must not wait on one.
  window.routely = state;
  drainQueue(queued, track);

  const config = await loadConfig(
    options.apiBase,
    options.siteId,
    options.timeoutMs,
    preview?.experimentId,
  );
  state.experiments = config?.experiments ?? [];
  state.degraded = config === null;

  if (state.degraded) {
    log("configuration unavailable — doing nothing");
    revealPage();
    return state;
  }

  log(`${state.experiments.length} experiment(s)`);

  if (preview) {
    runPreview(state, preview, href, log);
    return state;
  }

  if (bot) {
    log("crawler user agent — showing the control page, reporting nothing");
    state.action = "skip";
    revealPage();
    return state;
  }

  const url = normalizeUrl(href) ?? href;
  const visit: VisitContext = {
    href,
    referrer: typeof document !== "undefined" ? document.referrer : "",
    device: detectDevice(
      navigator.userAgent || "",
      window.innerWidth || 0,
      navigator.maxTouchPoints || 0,
    ),
    isNewVisitor: identity.isNew,
  };

  // A completed test that keeps its winner: redirect straight there, no assignment, no events.
  for (const experiment of state.experiments) {
    if (experiment.locked && redirectToWinner(experiment, href, visit)) {
      log(`sending traffic to the winner of ${experiment.id}`);
      state.action = "redirect";
      return state;
    }
  }

  const stores = resolveAssignmentStores();
  const events: TrackedEvent[] = [];
  const reportedAssignments: string[] = [];
  const changes: ChangeConfig[] = [];
  let redirect: { target: string; experimentId: string } | null = null;

  const participate = (
    experiment: LiveExperimentConfig,
    variantId: string | null,
    { pageView = true }: { pageView?: boolean } = {},
  ) => {
    state.assignments.push({ experimentId: experiment.id, variantId });
    const stored = readAssignment(experiment.id, stores);
    const includeAssignment = stored ? !stored.sent : true;
    if (includeAssignment) reportedAssignments.push(experiment.id);
    events.push(
      ...pageEvents(
        { experimentId: experiment.id, variantId, url },
        { includeAssignment, includePageView: pageView && claimPageView(experiment.id, url) },
      ),
    );
  };

  // A decision carried in from a redirect seeds the assignment on this origin, where storage
  // from the previous one is unavailable. `undefined` (not `null`) means "no forced value".
  const forced = (experiment: { id: string }): string | null | undefined =>
    handoff && handoff.experimentId === experiment.id ? handoff.variant : undefined;

  for (const experiment of state.experiments) {
    if (experiment.locked || experiment.preview) continue;

    // A Split URL variant's own page. The page rule describes the *entry* page (the control),
    // so the variant page usually fails it — yet it is where that arm's visitors actually are.
    // A visitor already holding (or handed) this arm is measured here: page view and visible
    // time belong to the page they saw, not to the control page they were redirected from.
    if (experiment.type === "redirect" && !pageMatches(experiment.targeting, href)) {
      const arm = experiment.arms.find(
        (candidate) => candidate.position > 0 && candidate.url && isSameUrl(href, candidate.url),
      );
      if (!arm) continue;
      const handed = forced(experiment);
      const held = handed !== undefined ? handed : readAssignment(experiment.id, stores)?.variantId;
      if (held === undefined || held !== arm.variantId) continue;
      participate(experiment, resolveAssignment(experiment, stores, { forced: handed }).variantId);
      continue;
    }
    if (!pageMatches(experiment.targeting, href)) continue;

    // Targeting and coverage gate *entry*. A visitor already holding an arm keeps it, so a
    // "new visitors" test does not flip back to control on their second page view.
    // A visitor handed over by this experiment's own redirect was gated on the page they came
    // from, and arrives without the parameters that page's conditions may have read.
    if (!readAssignment(experiment.id, stores) && forced(experiment) === undefined) {
      if (!isTargeted(experiment.targeting, visit)) {
        log(`not targeted by ${experiment.id}`);
        continue;
      }
      if (!resolveInclusion(experiment.id, experiment.coverage, stores).included) {
        log(`excluded from ${experiment.id} by coverage`);
        continue;
      }
    }

    if (experiment.type === "ab") {
      const { variantId } = resolveAssignment(experiment, stores);
      const arm = experiment.arms.find((candidate) => candidate.variantId === variantId);
      if (arm?.changes) changes.push(...arm.changes);
      participate(experiment, variantId);
      log(`${experiment.id}: arm ${arm?.position ?? 0}`);
      continue;
    }

    // At most one redirect per page load: the first redirect test claiming the page wins.
    if (redirect) continue;

    const decision = decide(
      href,
      [experiment],
      (candidate) => resolveAssignment(candidate, stores, { forced: forced(candidate) }).variantId,
      { visitorId: identity.id },
    );
    if (!decision) continue;

    if (decision.action === "skip") {
      log(`${experiment.id}: ${decision.reason}`);
      // An assignment still exists for a visitor already on a variant; report the page they
      // are actually on so the state is honest about which arm they are in.
      const stored = resolveAssignment(experiment, stores, { forced: forced(experiment) });
      participate(experiment, stored.variantId);
      continue;
    }

    // A visitor about to be redirected never sees this page: record the assignment only, and
    // let the variant page record its own page view and visible time.
    participate(experiment, decision.variantId, { pageView: decision.action !== "redirect" });
    if (decision.action === "redirect") {
      redirect = { target: decision.target, experimentId: experiment.id };
    }
  }

  state.assignment = state.assignments[0] ?? null;

  // The site-level page view: page-visit metrics and URL goals are matched against it by the
  // server. Last in the batch, so the assignments above are recorded before it is evaluated.
  if (claimPageView("", url)) events.push({ type: "page", url, ts: Date.now() });

  // One beacon for the whole page load, sent before any navigation: `sendBeacon` survives the
  // unload, so the events are not lost to the redirect that immediately follows them.
  if (events.length > 0 && send(events)) {
    state.reported = true;
    for (const experimentId of reportedAssignments) markAssignmentSent(experimentId, stores);
  }

  if (redirect) {
    log(`redirecting to ${redirect.target}`);
    state.action = "redirect";
    performRedirect(redirect.target, redirect.experimentId);
    // The page is being replaced; revealing it now would be the flash the cloak prevents.
    return state;
  }

  trackEngagement(options, state, url);

  if (changes.length > 0) {
    state.action = "apply";
    applyWhenReady(changes, revealPage);
  } else {
    state.action = state.assignments.length > 0 ? "stay" : "none";
    revealPage();
  }
  return state;
}

/** How soon a second winner redirect for one experiment counts as a bounce, not a revisit. */
const WINNER_BOUNCE_MS = 10_000;

/**
 * Sends a visitor on a completed test's page to its winner.
 *
 * Unlike a live test this is every visit, not once per session — the winner *is* the page now
 * — so the loop guard is different: never to the page already displayed, and never twice for
 * the same experiment within a few seconds, which is what a bounce between two pages looks like.
 */
function redirectToWinner(
  experiment: LockedExperimentConfig,
  href: string,
  visit: VisitContext,
): boolean {
  if (!pageMatches(experiment.targeting, href) || !isTargeted(experiment.targeting, visit)) {
    return false;
  }
  if (isSameUrl(href, experiment.target)) return false;

  const session = getSessionStorage();
  const key = "routely_w_" + experiment.id;
  try {
    const last = Number(session?.getItem(key));
    if (last > 0 && Date.now() - last < WINNER_BOUNCE_MS) return false;
    session?.setItem(key, String(Date.now()));
  } catch {
    // Without storage, the same-URL guard above is the one that remains.
  }

  try {
    window.location.replace(experiment.target);
    return true;
  } catch {
    return false;
  }
}

/**
 * A preview: force the requested arm and show it, storing and sending nothing.
 *
 * The page rule is not checked — the link was made for this experiment on purpose — and
 * neither are targeting or coverage, which decide who *enters* a live test.
 */
function runPreview(
  state: RoutelyState,
  preview: Preview,
  href: string,
  log: (...args: unknown[]) => void,
): void {
  const experiment = state.experiments.find(
    (candidate): candidate is LiveExperimentConfig =>
      !candidate.locked && candidate.id === preview.experimentId,
  );
  const arm = experiment?.arms.find((candidate) => candidate.position === preview.position);

  if (!experiment || !arm) {
    log("preview: no such experiment or arm");
    revealPage();
    return;
  }

  state.assignment = { experimentId: experiment.id, variantId: arm.variantId };
  state.assignments = [state.assignment];
  log(`preview: ${experiment.id} arm ${arm.position}`);

  if (experiment.type === "redirect") {
    if (arm.position > 0 && arm.url && !isSameUrl(withoutPreview(href), arm.url)) {
      state.action = "redirect";
      try {
        window.location.replace(withPreview(arm.url, preview));
        return;
      } catch {
        // Stay and show the page.
      }
    }
    state.action = "stay";
    revealPage();
    return;
  }

  state.action = "apply";
  applyWhenReady(arm.changes ?? [], revealPage);
}

/**
 * Measures how long the visitor keeps this page visible, for every experiment it takes part in.
 *
 * Not started on a page that is about to redirect: the visitor is there for milliseconds, and
 * counting that would drag the control arm's average down for a reason that has nothing to do
 * with the page.
 */
function trackEngagement(options: RoutelyOptions, state: RoutelyState, url: string): void {
  if (state.assignments.length === 0 || typeof document === "undefined") return;

  const timer = createEngagementTimer({
    visible: document.visibilityState !== "hidden",
  });

  attachEngagement(timer, (durationMs, isFinal) => {
    // Below the threshold a non-final flush is not worth a request; the final one always goes.
    if (!isFinal && durationMs < MIN_FLUSH_MS) return;
    if (!(durationMs > 0)) return;
    sendEvents(
      options.apiBase,
      options.siteId,
      state.visitorId,
      state.assignments.map(({ experimentId, variantId }) => ({
        type: "time_on_page" as const,
        experimentId,
        variantId,
        url,
        durationMs: Math.round(durationMs),
        ts: Date.now(),
      })),
    );
  });

  state.engagement = timer;
}

/**
 * Removes the handoff parameters from the address bar.
 *
 * Cosmetic but worth doing: they would otherwise be copied into shared links, bookmarked, and
 * sent to the customer's own analytics as though they were campaign parameters.
 * `replaceState` leaves history untouched, so Back still works.
 */
function cleanUrl(href: string): void {
  try {
    const cleaned = stripHandoff(href);
    if (cleaned !== href && typeof history !== "undefined" && history.replaceState) {
      history.replaceState(history.state, "", cleaned);
    }
  } catch {
    // A blocked history API is not worth failing over.
  }
}

if (typeof document !== "undefined") {
  // The rejection handler is the last line of defence. Everything inside `boot` already
  // resolves rather than throwing, so reaching this would be a bug — but a tracking script is
  // exactly the wrong place to find out about one via the customer's error reporting. The
  // page is revealed on that path too: a cloak left up by a crashed SDK would be a blank site.
  void boot().catch(() => revealPage());
}
