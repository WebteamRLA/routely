import type { EventBatch, TrackedEvent } from "./contract";
import { SDK_PROTOCOL_VERSION } from "./contract";

/**
 * Reporting events to the backend.
 *
 * Fire-and-forget by design: the SDK never waits for a response and never retries within a
 * page load. A dropped event costs one row of analytics; a blocked page costs the customer a
 * visitor, so the trade is not close.
 *
 * `assignment`, `page_view`, `time_on_page` and `conversion` are all emitted.
 */

/**
 * `sendBeacon` first: it hands the request to the browser, which delivers it even if the page
 * is navigating away — exactly the situation here, since an assignment is reported immediately
 * before a redirect. `fetch` with `keepalive` is the fallback for browsers without it.
 */
export function send(apiBase: string, batch: EventBatch): boolean {
  return post(apiBase + "/api/v1/events", batch);
}

/** Hands a JSON body to the browser for delivery. Returns whether it was accepted. Never throws. */
export function post(url: string, payload: unknown): boolean {
  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return false;
  }

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
 * Reports the assignment and the page view together.
 *
 * One request rather than two: they always occur at the same moment, and on the control page
 * the very next thing that happens may be a navigation away. Batching means a single beacon
 * has to survive the unload instead of two.
 *
 * `includeAssignment` is false on a page load where the visitor was already bucketed, so the
 * assignment is reported once rather than on every page they visit.
 */
export function sendPageEvents(
  apiBase: string,
  siteId: string,
  visitorId: string,
  context: { experimentId: string; variantId: TrackedEvent["variantId"]; url: string },
  options: { includeAssignment: boolean; includePageView: boolean },
  now: number = Date.now(),
): boolean {
  const events: TrackedEvent[] = [];

  if (options.includeAssignment) {
    events.push({
      experimentId: context.experimentId,
      variantId: context.variantId,
      type: "assignment",
      url: context.url,
      ts: now,
    });
  }

  if (options.includePageView) {
    events.push({
      experimentId: context.experimentId,
      variantId: context.variantId,
      type: "page_view",
      url: context.url,
      ts: now,
    });
  }

  return sendEvents(apiBase, siteId, visitorId, events);
}

/**
 * Reports a slice of visible time.
 *
 * Sent as a delta, not a running total: each call reports only what accumulated since the
 * last one, so the server can sum them without needing to know which was the final event, and
 * a dropped last beacon costs the tail rather than the whole measurement.
 */
export function sendTimeOnPage(
  apiBase: string,
  siteId: string,
  visitorId: string,
  context: { experimentId: string; variantId: TrackedEvent["variantId"]; url: string },
  durationMs: number,
  now: number = Date.now(),
): boolean {
  if (!(durationMs > 0)) return false;

  return sendEvents(apiBase, siteId, visitorId, [
    {
      experimentId: context.experimentId,
      variantId: context.variantId,
      type: "time_on_page",
      url: context.url,
      durationMs: Math.round(durationMs),
      ts: now,
    },
  ]);
}

/**
 * Reports that a visitor reached an experiment's conversion goal.
 *
 * Sent once per assignment by the client, and enforced as once per assignment by the database
 * — the unique constraint on `assignmentId` means a repeat is a no-op rather than an error, so
 * a duplicate beacon cannot inflate the metric even if this is somehow called twice.
 */
export function sendConversion(
  apiBase: string,
  siteId: string,
  visitorId: string,
  context: { experimentId: string; variantId: TrackedEvent["variantId"]; url: string },
  now: number = Date.now(),
): boolean {
  return sendEvents(apiBase, siteId, visitorId, [
    {
      experimentId: context.experimentId,
      variantId: context.variantId,
      type: "conversion",
      url: context.url,
      ts: now,
    },
  ]);
}
