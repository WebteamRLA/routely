import { describe, expect, it } from "vitest";

import {
  blankForm,
  eventNameError,
  formFromEvent,
  formFromReceived,
  formFromTemplate,
  handleSubmitSnippet,
  idempotentSnippet,
  isStepOneError,
  savesAsCode,
  suggestedEvents,
  toEventInput,
} from "@/components/events/event-form";
import { EVENT_TEMPLATES } from "@/lib/events";
import type { LibraryEvent } from "@/server/services/custom-event.service";
import { eventDefinitionSchema } from "@/validation/custom-event";

const site = "cmh1a2b3c4d5e6f7g8h9i0j1k";
const home = "https://acme.com/";
const form = (seed: Parameters<typeof blankForm>[1]) => blankForm(home, { name: "cta", ...seed });
const input = (seed: Parameters<typeof blankForm>[1]) => toEventInput(site, form(seed));
const valid = (value: unknown) => eventDefinitionSchema.safeParse(value).success;

const saved: LibraryEvent = {
  id: "e1",
  name: "signup",
  description: "From the footer",
  category: "Lead",
  method: "FORM",
  selector: "#signup",
  pageUrl: "https://acme.com/join",
  pageMatch: "PREFIX",
  formSuccess: "URL",
  successUrl: "https://acme.com/thanks",
  successMatch: "PREFIX",
  successSelector: null,
  successEvent: null,
  issueUrl: null,
  total: 0,
  lastReceivedAt: null,
  status: { state: "not_detected", label: "", note: "", tone: "idle" },
  unverifiedSubmission: false,
  usage: [],
};

describe("what a click event saves", () => {
  it("keeps the page an element was picked on, listening everywhere by default", () => {
    const value = input({ selector: "#apply", picked: true, pageUrl: "https://acme.com/jobs" });
    expect(value).toMatchObject({
      method: "CLICK",
      selector: "#apply",
      pageUrl: "https://acme.com/jobs",
      pageMatch: null,
    });
    expect(valid(value)).toBe(true);
  });

  it("does not tie a typed selector to the homepage default", () => {
    expect(input({ selector: ".cta" })).toMatchObject({ pageUrl: null, pageMatch: null });
  });

  it("keeps the page of a typed selector limited to it", () => {
    const value = input({ selector: ".cta", pageMatch: "EXACT", pageUrl: "acme.com/jobs" });
    expect(value).toMatchObject({ pageUrl: "https://acme.com/jobs", pageMatch: "EXACT" });
    expect(valid(value)).toBe(true);
  });

  it("sends nothing for a missing element, so the server can say so beside the field", () => {
    const value = input({ selector: "  " });
    expect(value).toMatchObject({ selector: null, pageUrl: null });
    expect(eventDefinitionSchema.safeParse(value).error?.issues[0]?.path).toEqual(["selector"]);
  });
});

describe("what a form event saves", () => {
  const seed = { method: "FORM", selector: "#f", picked: true } as const;

  it("confirms with a success page, form optional", () => {
    const value = input({ ...seed, successUrl: "acme.com/thanks", successMatch: "PREFIX" });
    expect(value).toMatchObject({
      formSuccess: "URL",
      successUrl: "https://acme.com/thanks",
      successMatch: "PREFIX",
    });
    expect(valid(value)).toBe(true);
    expect(valid(input({ method: "FORM", successUrl: "https://acme.com/t" }))).toBe(true);
  });

  it("confirms with a success message", () => {
    const value = input({ ...seed, success: "ELEMENT", successSelector: ".done" });
    expect(value).toMatchObject({ formSuccess: "ELEMENT", successSelector: ".done" });
    expect(valid(value)).toBe(true);
  });

  it("saves no form with a plugin's event, whatever was chosen first", () => {
    const value = input({ ...seed, success: "CALLBACK", successEvent: "wpcf7mailsent" });
    expect(value).toMatchObject({
      formSuccess: "CALLBACK",
      successEvent: "wpcf7mailsent",
      selector: null,
      pageUrl: null,
    });
    expect(valid(value)).toBe(true);
  });

  it("saves a developer callback as a JavaScript event", () => {
    const value = input({ ...seed, success: "DEVELOPER" });
    expect(savesAsCode(form({ ...seed, success: "DEVELOPER" }))).toBe(true);
    expect(value).toEqual({
      websiteId: site,
      name: "cta",
      description: null,
      category: null,
      method: "CODE",
    });
    expect(valid(value)).toBe(true);
  });

  it("still needs a form to count a plain submit", () => {
    expect(valid(input({ ...seed, success: "SUBMIT" }))).toBe(true);
    expect(valid(input({ method: "FORM", success: "SUBMIT" }))).toBe(false);
  });
});

describe("starting points", () => {
  it("opens a saved event without losing its configuration", () => {
    const opened = formFromEvent(home, saved);
    expect(opened).toMatchObject({ picked: true, pageMatch: "PREFIX", successMatch: "PREFIX" });
    expect(toEventInput(site, opened)).toEqual({
      websiteId: site,
      name: "signup",
      description: "From the footer",
      category: "Lead",
      method: "FORM",
      selector: "#signup",
      pageUrl: "https://acme.com/join",
      pageMatch: "PREFIX",
      formSuccess: "URL",
      successUrl: "https://acme.com/thanks",
      successMatch: "PREFIX",
      successSelector: null,
      successEvent: null,
    });
  });

  it("fills a suggestion and a received name, which only code can have sent", () => {
    const template = EVENT_TEMPLATES[0]!;
    expect(formFromTemplate(home, template)).toMatchObject({
      name: template.name,
      method: template.method,
      category: template.category,
      pageUrl: home,
    });
    expect(formFromReceived(home, "sent_by_code")).toMatchObject({
      name: "sent_by_code",
      method: "CODE",
    });
  });

  it("hides suggestions already in the library", () => {
    const first = EVENT_TEMPLATES[0]!;
    expect(suggestedEvents([])).toEqual(EVENT_TEMPLATES);
    expect(suggestedEvents([{ name: first.name }])).not.toContain(first);
  });
});

describe("feedback", () => {
  it("checks the name against the shared pattern", () => {
    expect(eventNameError(" apply_clicked ")).toBeNull();
    expect(eventNameError("checkout.step:2")).toBeNull();
    expect(eventNameError("")).toBe("Give this event a name.");
    expect(eventNameError("has spaces")).toMatch(/^Use letters/);
    expect(eventNameError("-leading")).toMatch(/^Use letters/);
  });

  it("knows which server errors live on step 1", () => {
    expect(isStepOneError({ name: "Taken" })).toBe(true);
    expect(isStepOneError({ selector: "Choose" })).toBe(false);
    expect(isStepOneError(undefined)).toBe(false);
  });

  it("puts the name into the code it shows", () => {
    expect(handleSubmitSnippet("signup")).toContain(`window.routely.track("signup");`);
    expect(handleSubmitSnippet("signup")).toContain("if (result.success)");
    expect(idempotentSnippet("signup")).toContain(`{ id: "order_123" }`);
  });
});
