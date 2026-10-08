import type { EventBatch, TrackedEvent } from "./contract";
import { SDK_PROTOCOL_VERSION } from "./contract";

/**
 * Reporting events to the backend.
 *
 * Fire-and-forget by design: the SDK never waits for a response and never retries within a
 * page load. A dropped event costs one row of analytics; a blocked page costs the customer a
 * visitor, so the trade is not close.
 *
 * Experiment events (`assignment`, `page_view`, `time_on_page`) and the site-level `page` and
 * `track` events are emitted. Conversions are not: the server derives them from `page` and
 * `track` against assignments it already holds, which is also what keeps a conversion from
 * being something the browser can simply claim.
 */

/**
 * `sendBeacon` first: it hands the request to the browser, which delivers it even if the page
 * is navigating away — exactly the situation here, since an assignment is reported immediately
 * before a redirect. `fetch` with `keepalive` is the fallback for browsers without it.
 */
export function send(apiBase: string, batch: EventBatch): boolean {
  const url = apiBase + "/api/v1/events";
  const body = JSON.stringify(batch);

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // text/plain keeps this a CORS-simple request: no preflight, so no round trip is spent
      // on an OPTIONS before the page unloads. The endpoint parses the body itself.
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(url, blob)) return true;
    }
  } catch {
    // Fall through to fetch.
  }

  try {
    if (typeof fetch === "function") {
      void fetch(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "omit",
        mode: "cors",
        keepalive: true,
      }).catch(() => {});
      return true;
    }
  } catch {
    // Nothing further to try.
  }

  return false;
}

/** Builds and sends a batch. Returns whether the browser accepted it for delivery. */
export function sendEvents(
  apiBase: string,
  siteId: string,
  visitorId: string,
  events: TrackedEvent[],
): boolean {
  if (events.length === 0) return false;

  return send(apiBase, {
    v: SDK_PROTOCOL_VERSION,
    siteId,
    visitorId,
    events,
  });
}

/**
 * The assignment and page-view events for one experiment on this page load.
 *
 * Returned rather than sent: everything a page load has to report — each experiment's events
 * plus the site-level `page` event — goes out as one batch, so a single beacon has to survive
 * the unload that a redirect is about to cause.
 *
 * `includeAssignment` is false on a page load where the visitor was already bucketed, so the
 * assignment is reported once rather than on every page they visit.
 */
export function pageEvents(
  context: { experimentId: string; variantId: string | null; url: string },
  options: { includeAssignment: boolean; includePageView: boolean },
  now: number = Date.now(),
): TrackedEvent[] {
  const events: TrackedEvent[] = [];
  if (options.includeAssignment) events.push({ ...context, type: "assignment", ts: now });
  if (options.includePageView) events.push({ ...context, type: "page_view", ts: now });
  return events;
}
