import { describe, expect, it } from "vitest";

import {
  blankForm,
  eventNameError,
  formFromEvent,
  formFromReceived,
  formFromTemplate,
  formTrigger,
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
  install: "GTM",
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
      install: "GTM",
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

  it("defaults a new click or form event to the pixel, and saves code events without one", () => {
    expect(input({ method: "CLICK", selector: "#apply" })).toMatchObject({ install: "MANUAL" });
    expect(
      input({ method: "FORM", install: "GTM", selector: "#f", success: "SUBMIT" }),
    ).toMatchObject({ install: "GTM" });
    expect(input({ method: "CODE", install: "GTM" })).not.toHaveProperty("install");
    expect(valid(input({ method: "CLICK", install: "GTM", selector: "#apply" }))).toBe(true);
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

describe("formTrigger: what the Tag Manager tag is built from", () => {
  it("is the trigger the pixel would get for the same settings", () => {
    expect(formTrigger(form({ method: "CLICK", selector: "#apply" }))).toEqual({
      name: "cta",
      kind: "click",
      selector: "#apply",
    });
    expect(
      formTrigger(
        form({
          method: "FORM",
          selector: "#lead",
          picked: true,
          pageUrl: "acme.com/contact",
          success: "URL",
          successUrl: "acme.com/thanks",
        }),
      ),
    ).toEqual({
      name: "cta",
      kind: "form",
      selector: "#lead",
      check: "https://acme.com/contact",
      success: "url",
      successUrl: { url: "https://acme.com/thanks", match: "EXACT" },
    });
  });

  it("is null while incomplete, and for events the site's own code reports", () => {
    expect(formTrigger(form({ method: "CLICK", selector: "" }))).toBeNull();
    expect(formTrigger(form({ method: "FORM", selector: "", success: "ELEMENT" }))).toBeNull();
    expect(formTrigger(form({ method: "FORM", selector: "#f", success: "ELEMENT" }))).toEqual({
      name: "cta",
      kind: "form",
      selector: "#f",
      success: "element",
    });
    expect(formTrigger(form({ method: "FORM", success: "DEVELOPER" }))).toBeNull();
    expect(formTrigger(form({ method: "CODE" }))).toBeNull();
    expect(formTrigger(form({ name: "has space", method: "CLICK", selector: "#a" }))).toBeNull();
  });
});

describe("a JavaScript event with an element", () => {
  it("keeps the element its Tag Manager script listens on, and builds no pixel trigger", () => {
    const seed = { method: "CODE" as const, selector: "#buy", pageUrl: "acme.com/shop" };
    expect(input(seed)).toEqual({
      websiteId: site,
      name: "cta",
      description: null,
      category: null,
      method: "CODE",
      selector: "#buy",
      pageUrl: "https://acme.com/shop",
    });
    expect(valid(input(seed))).toBe(true);
    expect(formTrigger(form(seed))).toBeNull();
    expect(input({ method: "CODE" })).not.toHaveProperty("selector");
  });
});
