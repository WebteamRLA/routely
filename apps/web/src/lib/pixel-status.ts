/**
 * A website's tracking status, as the designed screens show it: **Not installed**, **Active** or
 * **Not seen**.
 *
 * One signal decides it: when Routely last had evidence that the snippet is on the site —
 * `seen = max(lastSeenAt, pixelVerifiedAt)`.
 *
 *  - `lastSeenAt` is bumped by the SDK's site-wide page hit (`POST /api/v1/hit`), which every page
 *    carrying the snippet sends whether or not an experiment is running there. It is the real
 *    signal: the snippet ran in a real browser.
 *  - `pixelVerifiedAt` is when an install check last found the snippet in the page's HTML. It
 *    counts too, so a site checked a moment ago reads "Active" before its first visitor arrives.
 *
 * The 24-hour threshold comes from the Settings notification "Routely hasn't received any events
 * from a project's site for 24 hours" — the same instant at which that email fires, so the badge
 * and the email can never disagree about whether tracking has stopped.
 *
 * Pure and dependency-free apart from the date formatters: shared by server code and client
 * components, so the label beside a status cannot drift from the status itself.
 */

import { formatMonthDayYear, relativeTime } from "@/lib/experiment-time";

/** How long after the last evidence a site still counts as actively tracked. */
export const TRACKING_ACTIVE_MS = 24 * 60 * 60 * 1000;

export type TrackingState = "not_installed" | "active" | "not_seen";

export interface TrackingStatus {
  state: TrackingState;
  /** "Not installed" / "Active" / "Not seen". */
  label: string;
  /** `max(lastSeenAt, pixelVerifiedAt)`, or null when neither has happened. */
  seenAt: Date | null;
  /** Relative age of `seenAt` — "just now", "4 min ago", "25 d ago". Null when never seen. */
  when: string | null;
  /** `seenAt` as "Sep 22, 2026". Null when never seen. */
  since: string | null;
}

/** The two fields the status is derived from — a `Website` row satisfies this. */
export interface TrackingSignals {
  lastSeenAt: Date | null;
  pixelVerifiedAt: Date | null;
}

export const TRACKING_LABELS: Record<TrackingState, string> = {
  not_installed: "Not installed",
  active: "Active",
  not_seen: "Not seen",
};

/** The later of two optional instants. */
function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * The tracking status of a website at `now`.
 *
 * `timeZone` only affects `since` (the calendar label); the state never depends on it.
 */
export function trackingStatus(
  website: TrackingSignals,
  now: Date,
  timeZone = "UTC",
): TrackingStatus {
  const seenAt = latest(website.lastSeenAt, website.pixelVerifiedAt);

  if (!seenAt) {
    return {
      state: "not_installed",
      label: TRACKING_LABELS.not_installed,
      seenAt: null,
      when: null,
      since: null,
    };
  }

  const state: TrackingState =
    now.getTime() - seenAt.getTime() <= TRACKING_ACTIVE_MS ? "active" : "not_seen";

  return {
    state,
    label: TRACKING_LABELS[state],
    seenAt,
    when: relativeTime(seenAt, now, "short"),
    since: formatMonthDayYear(seenAt, timeZone),
  };
}
