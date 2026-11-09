import { describe, expect, it } from "vitest";

import {
  eventDefinitionSchema,
  filterEventProperties,
  selectorSchema,
  trackBatchSchema,
} from "@/validation/custom-event";

const SITE = "rt_0123456789abcdef0123456789abcdef";
const BASE = { websiteId: "clabc123", name: "apply_clicked", method: "CODE" as const };

describe("eventDefinitionSchema", () => {
  it("accepts any well-formed name", () => {
    for (const name of ["apply_button_clicked", "Purchase.Done", "a", "v2:signup-done"]) {
      expect(eventDefinitionSchema.safeParse({ ...BASE, name }).success).toBe(true);
    }
  });

  it("refuses a name with markup or spaces", () => {
    for (const name of ["a b", "<script>", "", "_x"]) {
      expect(eventDefinitionSchema.safeParse({ ...BASE, name }).success).toBe(false);
    }
  });

  it("requires what each method needs", () => {
    const bad = (input: object) =>
      eventDefinitionSchema.safeParse({ ...BASE, ...input }).success === false;
    expect(bad({ method: "CLICK" })).toBe(true);
    expect(bad({ method: "FORM" })).toBe(true);
    expect(bad({ method: "FORM", formSuccess: "SUBMIT" })).toBe(true);
    expect(bad({ method: "FORM", formSuccess: "URL" })).toBe(true);
    // A message needs only the form: without a selector the SDK watches around it.
    expect(bad({ method: "FORM", formSuccess: "ELEMENT", selector: "#f" })).toBe(false);
    expect(bad({ method: "FORM", formSuccess: "ELEMENT" })).toBe(true);
    expect(bad({ method: "FORM", formSuccess: "CALLBACK" })).toBe(true);
    expect(bad({ method: "CLICK", selector: "#a" })).toBe(false);
    expect(bad({ method: "FORM", formSuccess: "URL", successUrl: "https://a.test/t" })).toBe(false);
  });
});

describe("selectorSchema", () => {
  it("accepts real selectors", () => {
    for (const selector of [
      "#apply",
      'a[href="/apply"]',
      "body > div:nth-of-type(2) > a",
      "form.contact, form#lead",
    ]) {
      expect(selectorSchema.safeParse(selector).success).toBe(true);
    }
  });

  it("refuses markup and rule blocks", () => {
    for (const selector of ["<img src=x onerror=alert(1)>", "a{color:red}", "a\nb"]) {
      expect(selectorSchema.safeParse(selector).success).toBe(false);
    }
  });
});

describe("filterEventProperties", () => {
  it("keeps safe values and removes the rest, whatever the browser did", () => {
    expect(
      filterEventProperties({
        value: 150,
        currency: "USD",
        email: "a@b.co",
        password: "x",
        note: "call +1 415 555 2671",
        nested: { a: 1 },
      }),
    ).toEqual({ value: 150, currency: "USD" });
  });

  it("is null when nothing survives", () => {
    expect(filterEventProperties({ email: "a@b.co" })).toBeNull();
    expect(filterEventProperties("x")).toBeNull();
    expect(filterEventProperties(["a"])).toBeNull();
  });
});

describe("trackBatchSchema", () => {
  const event = { id: "e1", name: "a", url: "https://a.test/", ts: 1 };
  const batch = { v: 5, siteId: SITE, visitorId: "visitor-1", events: [event] };

  it("accepts a batch and refuses an oversized one", () => {
    expect(trackBatchSchema.safeParse(batch).success).toBe(true);
    const many = { ...batch, events: Array.from({ length: 21 }, () => event) };
    expect(trackBatchSchema.safeParse(many).success).toBe(false);
  });

  it("refuses an invalid event name", () => {
    const bad = { ...batch, events: [{ ...event, name: "a b" }] };
    expect(trackBatchSchema.safeParse(bad).success).toBe(false);
  });
});
