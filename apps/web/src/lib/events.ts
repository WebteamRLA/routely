/**
 * Custom events: everything several screens need to say about one, in one pure module.
 *
 * A definition proves nothing. Status comes from what actually arrived and from problems the SDK
 * reported on real pages, so an event is never shown as working just because its name exists.
 */

import type { EventTrigger } from "@routely/sdk/contract";

export type EventMethodName = "CLICK" | "FORM" | "CODE";
export type FormSuccessName = "SUBMIT" | "URL" | "ELEMENT" | "CALLBACK";

/** No events for this long and a receiving event reads "Inactive". The rule the Library states. */
export const EVENT_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const EVENT_ACTIVE_WINDOW_LABEL = "7 days";
/** Distinct unconfigured names one project may collect, so a bad script cannot flood the Library. */
export const MAX_UNDECLARED_EVENT_NAMES = 200;

export type EventState = "not_detected" | "active" | "inactive" | "config_error";

export interface EventStatus {
  state: EventState;
  label: string;
  /** What this means and what to do, for a tooltip or a warning. */
  note: string;
  tone: "ok" | "warn" | "fail" | "idle";
}

export interface EventSignals {
  method: EventMethodName | null;
  formSuccess: FormSuccessName | null;
  issueCode: string | null;
  total: number;
  lastReceivedAt: Date | null;
}

const ISSUE_NOTES: Record<string, string> = {
  selector_missing:
    "Routely couldn’t find this element on its page. It may have changed. Choose the element again.",
  form_ajax:
    "This form sends with JavaScript, so a submit doesn’t show it succeeded. Confirm it with a success page, a success message or a form plugin instead.",
};

export function eventStatus(signals: EventSignals, now: Date): EventStatus {
  if (signals.issueCode) {
    return {
      state: "config_error",
      label: "Configuration error",
      note: ISSUE_NOTES[signals.issueCode] ?? "Routely reported a problem with this event.",
      tone: "fail",
    };
  }
  if (!signals.lastReceivedAt) {
    return {
      state: "not_detected",
      label: "Created · Not yet detected",
      note: "Routely hasn’t received this event yet. Perform the action on your site to test it.",
      tone: "idle",
    };
  }
  if (now.getTime() - signals.lastReceivedAt.getTime() <= EVENT_ACTIVE_WINDOW_MS) {
    return { state: "active", label: "Active · Receiving events", note: "", tone: "ok" };
  }
  return {
    state: "inactive",
    label: "Inactive · No recent events",
    note: `Nothing received in the last ${EVENT_ACTIVE_WINDOW_LABEL}. It may simply not have happened, or the tracking may have stopped.`,
    tone: "warn",
  };
}

/** True for a form event that can't tell an accepted submission from a rejected one. */
export function submissionUnverified(
  method: EventMethodName | null,
  success: FormSuccessName | null,
): boolean {
  return method === "FORM" && success === "SUBMIT";
}

export const METHOD_LABELS: Record<EventMethodName, string> = {
  CLICK: "Element click",
  FORM: "Form submission",
  CODE: "JavaScript",
};

export const FORM_SUCCESS_LABELS: Record<FormSuccessName, string> = {
  SUBMIT: "Form submitted",
  URL: "Success page",
  ELEMENT: "Success message",
  CALLBACK: "Form plugin",
};

/** Form plugins whose success event the SDK can listen for. */
export const FORM_PLATFORMS: readonly { id: string; label: string; event: string }[] = [
  { id: "cf7", label: "Contact Form 7", event: "wpcf7mailsent" },
  { id: "wpforms", label: "WPForms (AJAX)", event: "wpformsAjaxSubmitSuccess" },
  { id: "elementor", label: "Elementor Forms", event: "submit_success" },
  { id: "gravity", label: "Gravity Forms (AJAX)", event: "gform_confirmation_loaded" },
];

export interface EventTemplate {
  name: string;
  label: string;
  method: EventMethodName;
  category: string;
}

/** Starting points only: any name and method can be used. */
export const EVENT_TEMPLATES: readonly EventTemplate[] = [
  { name: "apply_button_clicked", label: "Apply button", method: "CLICK", category: "Engagement" },
  {
    name: "contact_button_clicked",
    label: "Contact button",
    method: "CLICK",
    category: "Engagement",
  },
  { name: "add_to_cart", label: "Add to cart", method: "CODE", category: "Ecommerce" },
  { name: "form_submitted", label: "Form submitted", method: "FORM", category: "Lead" },
  { name: "signup_completed", label: "Signup completed", method: "CODE", category: "Lead" },
  {
    name: "purchase_completed",
    label: "Purchase completed",
    method: "CODE",
    category: "Ecommerce",
  },
  { name: "demo_requested", label: "Demo requested", method: "FORM", category: "Lead" },
  { name: "newsletter_subscribed", label: "Newsletter signup", method: "FORM", category: "Lead" },
  { name: "phone_number_clicked", label: "Phone number", method: "CLICK", category: "Engagement" },
  { name: "email_clicked", label: "Email link", method: "CLICK", category: "Engagement" },
  { name: "file_downloaded", label: "File download", method: "CLICK", category: "Engagement" },
];

/** The stored fields a trigger is built from. */
export interface TriggerSource {
  name: string;
  method: EventMethodName;
  selector: string | null;
  pageUrl: string | null;
  pageMatch: "EXACT" | "PREFIX" | null;
  formSuccess: FormSuccessName | null;
  successUrl: string | null;
  successMatch: "EXACT" | "PREFIX";
  successSelector: string | null;
  successEvent: string | null;
  issueCode: string | null;
}

/**
 * A definition as the SDK reads it, or null when there is nothing to listen for: an event the
 * site's own code reports needs no trigger, and an incomplete row is skipped, not half-served.
 */
export function toEventTrigger(source: TriggerSource): EventTrigger | null {
  const { name, selector, pageUrl, pageMatch } = source;
  const base = {
    name,
    ...(selector ? { selector } : {}),
    ...(pageUrl && pageMatch ? { page: { url: pageUrl, match: pageMatch } } : {}),
    ...(selector && pageUrl ? { check: pageUrl } : {}),
    ...(source.issueCode === "selector_missing" ? { flagged: true } : {}),
  };

  if (source.method === "CLICK") return selector ? { ...base, kind: "click" } : null;
  if (source.method !== "FORM" || !source.formSuccess) return null;

  switch (source.formSuccess) {
    case "SUBMIT":
      return selector ? { ...base, kind: "form", success: "submit" } : null;
    case "URL":
      return source.successUrl
        ? {
            ...base,
            kind: "form",
            success: "url",
            successUrl: { url: source.successUrl, match: source.successMatch },
          }
        : null;
    case "ELEMENT":
      // No message selector: the SDK watches around the form for a new message instead.
      return selector
        ? {
            ...base,
            kind: "form",
            success: "element",
            ...(source.successSelector ? { successSelector: source.successSelector } : {}),
          }
        : null;
    case "CALLBACK":
      return source.successEvent
        ? { ...base, kind: "form", success: "callback", successEvent: source.successEvent }
        : null;
  }
}

/**
 * The main JavaScript-event snippet, laid out to read without scrolling: the queue line (safe before
 * the Routely script loads, harmless when it is blocked) and the call, in a `<script>` tag for a
 * page or a Google Tag Manager Custom HTML tag.
 */
export function trackScript(name: string): string {
  return `<script type="text/javascript">
  window.routely = window.routely || {
    q: [],
    track: function () { this.q.push(arguments); },
  };
  window.routely.track(${JSON.stringify(name).replace(/</g, "\\u003C")});
</script>`;
}

/**
 * A JavaScript event tied to a chosen element (user request 2026-11-10): a Google Tag Manager Custom
 * HTML tag (trigger: All Pages) that reports a click on that element, or on anything inside it,
 * through `routely.track`. The event is saved as JavaScript, so the pixel never listens for the
 * same click: this script is the only thing that counts it. Plain ES5 for older containers.
 */
export function elementTrackScript(name: string, selector: string): string {
  const literal = (value: string) => JSON.stringify(value).replace(/</g, "\\u003C");
  return `<script type="text/javascript">
  window.routely = window.routely || {
    q: [],
    track: function () { this.q.push(arguments); },
  };
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest(${literal(selector)});
    if (el) window.routely.track(${literal(name)});
  }, true);
</script>`;
}

/**
 * The code a developer pastes after the action succeeds. The first line makes it safe wherever it
 * runs: before the SDK loads the call waits in a queue, and with the SDK blocked it does nothing,
 * so it can never break the customer's page.
 */
export function trackSnippet(name: string, withProperties = false): string {
  const props = withProperties ? `, { value: 150, currency: "USD" }` : "";
  return `window.routely = window.routely || { q: [], track: function () { this.q.push(arguments); } };
window.routely.track(${JSON.stringify(name)}${props});`;
}
