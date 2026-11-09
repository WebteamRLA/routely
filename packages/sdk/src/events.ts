import type { CustomEventPayload, EventIssue, EventTrigger, TrackBatch } from "./contract";
import {
  EVENT_BURST_MS,
  EVENT_NAME_PATTERN,
  EVENT_PROPERTY_KEY_PATTERN,
  FORM_SUBMITTED_KEY,
  FORM_SUBMIT_MEMORY_MS,
  FORM_SUCCESS_WATCH_MS,
  MAX_EVENT_PROPERTIES,
  MAX_EVENT_PROPERTY_LENGTH,
  SDK_PROTOCOL_VERSION,
  SENSITIVE_PROPERTY_KEY,
  SENSITIVE_PROPERTY_VALUE,
} from "./contract";
import { getLocalStorage, getSessionStorage, randomId } from "./env";
import { post } from "./track";
import { isSameUrl, normalizeUrl, urlMatches } from "./url";

/**
 * Custom events: `routely.track()` and the click and form triggers a project configured.
 *
 * The browser only says *what happened*. It names no experiment and no arm: the server reads the
 * visitor's stored assignment, so an event can never be attributed to an arm the visitor is not in.
 *
 * Counting rules. Every occurrence is reported; a repeat within `EVENT_BURST_MS` is treated as one action
 * (a double click, a callback firing twice, two listeners). A real second click later is a second
 * event. Conversions are a different number: at most one per visitor per experiment, by the
 * database's unique index, so repeats can never raise a conversion rate.
 */

export interface EventContext {
  apiBase: string;
  siteId: string;
  visitorId: string;
}

/** Left for a page's scripts to render, before a selector counts as missing. */
const CHECK_DELAY_MS = 3000;
const QUEUE_KEY = "routely_evq";
const MAX_QUEUED = 20;
const CHECKED_KEY = "routely_chk_";

const lastSent = new Map<string, number>();
let listening = false;

/** Test seam. */
export function resetEvents(): void {
  lastSent.clear();
  listening = false;
}

/** Keeps only flat, non-sensitive properties. The server applies the same rules again. */
export function safeProperties(input: unknown): CustomEventPayload["props"] {
  if (typeof input !== "object" || input === null) return undefined;
  const props: NonNullable<CustomEventPayload["props"]> = {};
  let count = 0;

  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_EVENT_PROPERTIES) break;
    if (!EVENT_PROPERTY_KEY_PATTERN.test(key) || SENSITIVE_PROPERTY_KEY.test(key)) continue;
    const ok =
      typeof value === "string"
        ? value.length <= MAX_EVENT_PROPERTY_LENGTH && !SENSITIVE_PROPERTY_VALUE.test(value)
        : typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
    if (!ok) continue;
    props[key] = value as string | number | boolean;
    count += 1;
  }
  return count > 0 ? props : undefined;
}

function deliver(context: EventContext, events: CustomEventPayload[], issues?: EventIssue[]): void {
  const batch: TrackBatch = {
    v: SDK_PROTOCOL_VERSION,
    siteId: context.siteId,
    visitorId: context.visitorId,
    ...(events.length ? { events } : {}),
    ...(issues ? { issues } : {}),
  };
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline || !post(context.apiBase + "/api/v1/track", batch)) enqueue(events);
}

/** Holds events a dead connection could not take. Each keeps its id, so a resend cannot double. */
function enqueue(events: CustomEventPayload[]): void {
  const store = getLocalStorage();
  if (!store || events.length === 0) return;
  try {
    const held = JSON.parse(store.getItem(QUEUE_KEY) || "[]") as CustomEventPayload[];
    store.setItem(QUEUE_KEY, JSON.stringify(held.concat(events).slice(-MAX_QUEUED)));
  } catch {
    // Nowhere to keep it: the event is lost, which is the worst this can do.
  }
}

export function flushQueue(context: EventContext): void {
  const store = getLocalStorage();
  try {
    const held = store?.getItem(QUEUE_KEY);
    if (!held || navigator.onLine === false) return;
    store!.removeItem(QUEUE_KEY);
    deliver(context, JSON.parse(held) as CustomEventPayload[]);
  } catch {
    // A corrupt queue is dropped.
  }
}

/** Reports one event. False when the name is invalid or it repeats one sent a moment ago. */
export function trackEvent(
  context: EventContext,
  name: unknown,
  properties?: unknown,
  options?: { id?: unknown },
  now: number = Date.now(),
): boolean {
  if (typeof name !== "string" || !EVENT_NAME_PATTERN.test(name)) return false;

  const props = safeProperties(properties);
  const burstKey = name + JSON.stringify(props);
  if (now - (lastSent.get(burstKey) ?? -Infinity) < EVENT_BURST_MS) return false;
  lastSent.set(burstKey, now);

  const href = typeof location === "undefined" ? "" : location.href;
  const id = options?.id;
  deliver(context, [
    {
      id: typeof id === "string" && id ? id.slice(0, 64) : randomId(),
      name,
      url: normalizeUrl(href) ?? href,
      ts: now,
      ...(props ? { props } : {}),
    },
  ]);
  return true;
}

function closest(target: EventTarget | null, selector: string): boolean {
  try {
    return !!(target as Element | null)?.closest?.(selector);
  } catch {
    return false; // A selector this browser cannot parse never matches.
  }
}

function visible(selector: string): boolean {
  try {
    const element = document.querySelector(selector);
    return !!element && element.getClientRects().length > 0;
  } catch {
    return false;
  }
}

/** Fires when `selector` goes from hidden to visible soon after a submission. */
function watchForSuccess(selector: string, fire: () => void): void {
  if (visible(selector) || typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver(() => {
    if (!visible(selector)) return;
    observer.disconnect();
    fire();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  setTimeout(() => observer.disconnect(), FORM_SUCCESS_WATCH_MS);
}

/** Reports a form confirmed by reaching a page: this page is it, and (when a form is named) that
 * form was submitted in this tab recently, so a visit from anywhere else is not a submission. */
function checkSuccessPage(trigger: EventTrigger, href: string, fire: () => void): void {
  const page = trigger.successUrl;
  if (trigger.success !== "url" || !page || !urlMatches(href, page.url, page.match)) return;
  const session = getSessionStorage();
  const key = FORM_SUBMITTED_KEY + trigger.name;
  try {
    const at = Number(session?.getItem(key));
    if (trigger.selector && !(Date.now() - at < FORM_SUBMIT_MEMORY_MS)) return;
    if (!trigger.selector && at < 0) return; // Already counted this session; a reload is not new.
    session?.setItem(key, "-1");
  } catch {
    // Without session storage a reload could repeat it, which the conversion index still absorbs.
  }
  fire();
}

function checkSelector(context: EventContext, trigger: EventTrigger, href: string): void {
  if (!trigger.selector || !trigger.check || !isSameUrl(href, trigger.check)) return;
  const session = getSessionStorage();
  const key = CHECKED_KEY + trigger.name;
  if (session?.getItem(key)) return;

  setTimeout(() => {
    let found = false;
    try {
      found = !!document.querySelector(trigger.selector!);
    } catch {
      // An unparsable selector is as good as a missing element.
    }
    if (found && !trigger.flagged) return;
    try {
      session?.setItem(key, "1");
    } catch {
      // Reported again on the next page load instead.
    }
    deliver(
      context,
      [],
      [
        {
          name: trigger.name,
          code: found ? "selector_ok" : "selector_missing",
          url: normalizeUrl(href) ?? href,
        },
      ],
    );
  }, CHECK_DELAY_MS);
}

/**
 * Starts listening for a project's triggers. One click listener and one submit listener serve them
 * all, on the document, so a button rendered later is covered and nothing is attached per element.
 *
 * Clicks are read in the capture phase: a site's own handler may stop propagation or navigate, and
 * neither may hide the click. Submits are read last, on `window`, because only then is
 * `defaultPrevented` the final word. Nothing here prevents, stops or changes anything.
 */
export function startTriggers(context: EventContext, triggers: EventTrigger[], href: string): void {
  if (listening || triggers.length === 0) return;
  listening = true;

  const fire = (trigger: EventTrigger) => () => void trackEvent(context, trigger.name);
  const onPage = (trigger: EventTrigger) =>
    !trigger.page || urlMatches(href, trigger.page.url, trigger.page.match);

  for (const trigger of triggers) {
    checkSuccessPage(trigger, href, fire(trigger));
    checkSelector(context, trigger, href);
    if (trigger.success === "callback" && trigger.successEvent) {
      const heard = (event: Event) => {
        // Some plugins announce on `document` itself, where no form can be named: that still counts.
        const whole = event.target === document;
        if (!trigger.selector || whole || closest(event.target, trigger.selector)) fire(trigger)();
      };
      document.addEventListener(trigger.successEvent, heard);
      // Many form plugins announce success with jQuery, which a DOM listener never hears.
      (window as { jQuery?: (d: Document) => { on(n: string, f: (e: Event) => void): void } })
        .jQuery?.(document)
        .on(trigger.successEvent, heard);
    }
  }

  const active = triggers.filter((trigger) => trigger.selector && onPage(trigger));
  const clicks = active.filter((trigger) => trigger.kind === "click");
  const forms = active.filter((trigger) => trigger.kind === "form");

  if (clicks.length > 0) {
    document.addEventListener(
      "click",
      (event) => {
        for (const trigger of clicks) {
          if (closest(event.target, trigger.selector!)) fire(trigger)();
        }
      },
      true,
    );
  }

  if (forms.length > 0) {
    window.addEventListener("submit", (event) => {
      for (const trigger of forms) {
        if (!closest(event.target, trigger.selector!)) continue;
        if (trigger.success === "url") {
          try {
            getSessionStorage()?.setItem(FORM_SUBMITTED_KEY + trigger.name, String(Date.now()));
          } catch {
            // Without session storage the success page cannot tie back to this form.
          }
        } else if (trigger.success === "element" && trigger.successSelector) {
          watchForSuccess(trigger.successSelector, fire(trigger));
        } else if (trigger.success === "submit") {
          // A cancelled submit may be a failed validation or an AJAX send: nothing here can tell,
          // so it is not counted, and the project is told this form needs another confirmation.
          if (!event.defaultPrevented) fire(trigger)();
          else deliver(context, [], [{ name: trigger.name, code: "form_ajax", url: href }]);
        }
      }
    });
  }

  window.addEventListener("online", () => flushQueue(context));
}
