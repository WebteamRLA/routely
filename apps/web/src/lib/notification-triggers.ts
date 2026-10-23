/**
 * When the two system-triggered notifications fire (spec §5.5): **A result is ready** and
 * **Tracking stops** — plus the per-process throttle that keeps the first off the ingestion hot
 * path, and the visitor-day retention cutoff the same daily cron applies.
 *
 * Pure: no database, no `env`, no server imports. The jobs in `server/jobs/*` read the facts,
 * ask these functions, and then take a compare-and-set latch in the database that restates the
 * same conditions — so the decision is unit-testable here while the database still has the final
 * word under concurrency.
 */

import { TRACKING_ACTIVE_MS, trackingStatus } from "@/lib/pixel-status";
import { analyzeResults, type ArmCounts } from "@/lib/verdict";

// ---------------------------------------------------------------------------------------------
// A result is ready
// ---------------------------------------------------------------------------------------------

export type ExperimentStatusName = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";

export interface ResultReadyFacts {
  status: ExperimentStatusName;
  /** The latch. Non-null once the notification has been claimed. */
  resultReadyAt: Date | null;
  /**
   * Control first, then every variant in position order — the same arms, with the same counts
   * (all assignments, all conversions), that the results page passes to `analyzeResults`, so the
   * email can never announce a result the page does not show.
   */
  arms: readonly ArmCounts[];
}

/**
 * True when an experiment should announce RESULT_READY now: it is running, it has not announced
 * before, and every arm has passed the `lib/verdict.ts` gate (1,000 assigned visitors and 100
 * conversions each).
 *
 * Only ACTIVE counts — the spec's "first becomes true for an ACTIVE experiment". A paused
 * experiment cannot gain data (ingestion only accepts ACTIVE), and one that crossed the gate
 * moments before it was paused is caught by the first check after it resumes. A completed
 * experiment's result is announced by its own ending, not by this email.
 *
 * At least one variant is required: "every version passed" means nothing for a lone control.
 */
export function isResultReady(facts: ResultReadyFacts): boolean {
  if (facts.status !== "ACTIVE") return false;
  if (facts.resultReadyAt !== null) return false;
  if (facts.arms.length < 2) return false;
  return analyzeResults(facts.arms).enough;
}

// ---------------------------------------------------------------------------------------------
// Per-key throttle
// ---------------------------------------------------------------------------------------------

export interface KeyedThrottle {
  /**
   * True — and the key is then held for the interval — when `key` has not been claimed within the
   * last interval. Synchronous, so two calls in one process can never both win.
   */
  tryClaim(key: string, now?: number): boolean;
  /** Keys currently held (expired ones may linger until the next eviction). */
  readonly size: number;
  /** Test seam: forget everything. */
  clear(): void;
}

/**
 * A bounded, in-memory "at most once per `intervalMs` per key" gate.
 *
 * It sheds load; it guarantees nothing. Correctness lives in the database latch the caller takes
 * afterwards, so forgetting a key — after a restart, in another process, or when the map
 * overflows and is cleared (the same overflow policy as `server/http/rate-limit.ts`) — costs at
 * most one extra cheap check, never a duplicate notification.
 */
export function createKeyedThrottle(intervalMs: number, maxKeys = 10_000): KeyedThrottle {
  /** key → epoch ms at which it may be claimed again. */
  const heldUntil = new Map<string, number>();

  function evict(now: number): void {
    for (const [key, until] of heldUntil) {
      if (until <= now) heldUntil.delete(key);
    }
    if (heldUntil.size >= maxKeys) heldUntil.clear();
  }

  return {
    tryClaim(key, now = Date.now()) {
      const until = heldUntil.get(key);
      if (until !== undefined && until > now) return false;
      if (until === undefined && heldUntil.size >= maxKeys) evict(now);
      heldUntil.set(key, now + intervalMs);
      return true;
    },
    get size() {
      return heldUntil.size;
    },
    clear() {
      heldUntil.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tracking stops
// ---------------------------------------------------------------------------------------------

export interface TrackingAlertFacts {
  /** Last site-wide SDK hit. */
  lastSeenAt: Date | null;
  /** Last install check that found the snippet in the page's HTML. */
  pixelVerifiedAt: Date | null;
  /** The latch: when "Tracking stops" was last sent for this website. */
  trackingAlertSentAt: Date | null;
  /** How many of the website's experiments are ACTIVE. */
  activeExperiments: number;
}

export type TrackingAlertDecision =
  | "send"
  /** No hit has ever arrived, so nothing has *stopped* — the dashboards show "Not installed". */
  | "never_seen"
  /** The tracking badge still reads "Active". */
  | "still_active"
  /** Already sent for this outage; re-arms when a hit arrives after the alert. */
  | "already_alerted"
  /** Nothing running there, so a quiet site costs the customer nothing worth an email. */
  | "no_active_experiment";

/**
 * Whether to send "Tracking stops" for a website at `now`.
 *
 * - **Stopped** means the tracking badge reads "Not seen" — the decision calls `trackingStatus`
 *   itself, so the email and the badge cannot disagree. A recent install check therefore holds
 *   the email back exactly as long as it holds the badge on "Active".
 * - **Had tracking** means at least one real hit (`lastSeenAt`): a site that was only ever
 *   verified has not stopped anything, and the email's "for N hours" counts from the last hit.
 * - **Once per outage.** The latch is `trackingAlertSentAt ≥ lastSeenAt`. A hit after the alert
 *   moves `lastSeenAt` past it, which re-arms the website without anyone clearing the latch — the
 *   cron's explicit clear (`isTrackingAlertRearmable`) is housekeeping, not the mechanism.
 * - **Only with an ACTIVE experiment** (spec §5.5's recommendation). The email's whole point —
 *   "running experiments there aren't recording visitors or conversions" — is false without one,
 *   and quiet nights on sites with nothing running would otherwise produce a daily alert.
 */
export function trackingAlertDecision(facts: TrackingAlertFacts, now: Date): TrackingAlertDecision {
  if (facts.lastSeenAt === null) return "never_seen";
  if (trackingStatus(facts, now).state !== "not_seen") return "still_active";
  if (
    facts.trackingAlertSentAt !== null &&
    facts.trackingAlertSentAt.getTime() >= facts.lastSeenAt.getTime()
  ) {
    return "already_alerted";
  }
  if (facts.activeExperiments <= 0) return "no_active_experiment";
  return "send";
}

/** True when a hit has arrived since the last alert, so the latch can be cleared. */
export function isTrackingAlertRearmable(
  facts: Pick<TrackingAlertFacts, "lastSeenAt" | "trackingAlertSentAt">,
): boolean {
  return (
    facts.trackingAlertSentAt !== null &&
    facts.lastSeenAt !== null &&
    facts.lastSeenAt.getTime() > facts.trackingAlertSentAt.getTime()
  );
}

/**
 * The instant before which neither the last hit nor the last install check may fall for a
 * website to read "Not seen" — `trackingStatus`'s threshold, for the SQL side of the latch.
 */
export function trackingStoppedCutoff(now: Date): Date {
  return new Date(now.getTime() - TRACKING_ACTIVE_MS);
}

// ---------------------------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------------------------

/** Days of `website_visitor_days` / `page_visitor_days` kept (spec §1.4). */
export const VISITOR_DAY_RETENTION_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first UTC day that is kept: rows whose `day` is strictly before it are deleted.
 *
 * A row for the day exactly `days` days ago is 400 days old, not older, so it survives; the day
 * before it goes. Every screen reads at most the last 30 days, so the margin is all history.
 */
export function retentionCutoff(now: Date, days = VISITOR_DAY_RETENTION_DAYS): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - days * DAY_MS);
}
