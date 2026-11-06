/**
 * The Create/Edit Event flow's form, and how it becomes `eventDefinitionSchema`'s input. Pure, so
 * the rules below are tested without a DOM. The server validates everything again.
 *
 * Three things here are decisions, not plumbing:
 *
 *  - `pageUrl` is saved when the element was picked there (or the event is limited to that page).
 *    The SDK treats a saved page as "this element must exist here" and reports it missing
 *    otherwise, so a hand-typed selector must not inherit the homepage default.
 *  - "Developer callback" is a way of confirming a form, but what it saves is a JavaScript event.
 *  - A form plugin saves no form. The SDK would then require the plugin's event to start inside
 *    that form, and plugins announce success on `document` or on a wrapper around the form, which
 *    would silently count nothing.
 */

import { EVENT_NAME_PATTERN } from "@routely/sdk/contract";

import {
  EVENT_TEMPLATES,
  type EventMethodName,
  type EventTemplate,
  type FormSuccessName,
  trackSnippet,
} from "@/lib/events";
import { withScheme } from "@/lib/launch-rules";
import type { LibraryEvent } from "@/server/services/custom-event.service";

export type UrlMatch = "EXACT" | "PREFIX";
export type SuccessChoice = FormSuccessName | "DEVELOPER";

export interface EventForm {
  name: string;
  description: string;
  category: string;
  method: EventMethodName;
  selector: string;
  /** What the picker called the element. Null for a typed or previously saved selector. */
  elementLabel: string | null;
  /** The page URL field: where the picker opens, and the page an event may be limited to. */
  pageUrl: string;
  /** `selector` was chosen on `pageUrl`, so that page is saved with it. */
  picked: boolean;
  /** Null listens on every page. */
  pageMatch: UrlMatch | null;
  success: SuccessChoice;
  successUrl: string;
  successMatch: UrlMatch;
  successSelector: string;
  successEvent: string;
}

/** Where a form starts: blank, or with fields a template or a received name filled in. */
export function blankForm(homepage: string, seed: Partial<EventForm> = {}): EventForm {
  return {
    name: "",
    description: "",
    category: "",
    method: "CLICK",
    selector: "",
    elementLabel: null,
    pageUrl: homepage,
    picked: false,
    pageMatch: null,
    success: "URL",
    successUrl: "",
    successMatch: "EXACT",
    successSelector: "",
    successEvent: "",
    ...seed,
  };
}

export function formFromTemplate(homepage: string, template: EventTemplate): EventForm {
  return blankForm(homepage, {
    name: template.name,
    category: template.category,
    method: template.method,
  });
}

/** A name that arrived but was never set up. Only code can have sent it. */
export function formFromReceived(homepage: string, name: string): EventForm {
  return blankForm(homepage, { name, method: "CODE" });
}

export function formFromEvent(homepage: string, event: LibraryEvent): EventForm {
  return blankForm(homepage, {
    name: event.name,
    description: event.description ?? "",
    category: event.category ?? "",
    method: event.method ?? "CODE",
    selector: event.selector ?? "",
    pageUrl: event.pageUrl ?? homepage,
    picked: !!event.pageUrl && !!event.selector,
    pageMatch: event.pageMatch,
    success: event.formSuccess ?? "URL",
    successUrl: event.successUrl ?? "",
    successMatch: event.successMatch,
    successSelector: event.successSelector ?? "",
    successEvent: event.successEvent ?? "",
  });
}

/** True for an event this form saves with no selector or page of its own. */
export function savesAsCode(form: EventForm): boolean {
  return form.method === "CODE" || (form.method === "FORM" && form.success === "DEVELOPER");
}

const text = (value: string) => value.trim() || null;
const url = (value: string) => withScheme(value) || null;

/** The input `createEventAction` and `updateEventAction` take. */
export function toEventInput(websiteId: string, form: EventForm): Record<string, unknown> {
  const base = {
    websiteId,
    name: form.name.trim(),
    description: text(form.description),
    category: text(form.category),
  };
  if (savesAsCode(form)) return { ...base, method: "CODE" };

  const isForm = form.method === "FORM";
  const success = form.success as FormSuccessName;
  const selector = isForm && success === "CALLBACK" ? null : text(form.selector);
  const pageUrl = selector && (form.picked || form.pageMatch) ? url(form.pageUrl) : null;
  const where = { selector, pageUrl, pageMatch: selector ? form.pageMatch : null };

  if (!isForm) return { ...base, method: "CLICK", ...where };
  return {
    ...base,
    method: "FORM",
    ...where,
    formSuccess: success,
    successUrl: success === "URL" ? url(form.successUrl) : null,
    successMatch: form.successMatch,
    successSelector: success === "ELEMENT" ? text(form.successSelector) : null,
    successEvent: success === "CALLBACK" ? text(form.successEvent) : null,
  };
}

export const EVENT_NAME_HINT =
  "Use letters, numbers, dots, colons, dashes and underscores, up to 64 characters, starting with a letter or number.";

export function eventNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give this event a name.";
  return EVENT_NAME_PATTERN.test(trimmed) ? null : EVENT_NAME_HINT;
}

/** The fields on step 1, where a server error on one of them has to send the user back to. */
const STEP_ONE_FIELDS: ReadonlySet<string> = new Set(["name", "description", "category"]);

export function isStepOneError(fieldErrors: Record<string, string> | undefined): boolean {
  return Object.keys(fieldErrors ?? {}).some((field) => STEP_ONE_FIELDS.has(field));
}

/** Suggestions still worth offering: a name already in the library is not. */
export function suggestedEvents(existing: readonly { name: string }[]): readonly EventTemplate[] {
  const names = new Set(existing.map((event) => event.name));
  return EVENT_TEMPLATES.filter((template) => !names.has(template.name));
}

/** `trackSnippet(name)` inside the handler that knows the action worked. */
export function handleSubmitSnippet(name: string): string {
  const call = trackSnippet(name)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `async function handleSubmit(event) {
  event.preventDefault();
  const result = await sendToYourServer(event.target);

  if (result.success) {
${call}
  }
}`;
}

/** The third argument: a repeat of the same id counts once. */
export function idempotentSnippet(name: string): string {
  return `window.routely.track(${JSON.stringify(name)}, { value: 150, currency: "USD" }, { id: "order_123" });`;
}
