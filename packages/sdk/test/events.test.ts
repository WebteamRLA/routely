import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventTrigger, TrackBatch } from "../src/contract";
import { createMemoryStore } from "../src/env";
import {
  type EventContext,
  flushQueue,
  resetEvents,
  safeProperties,
  startTriggers,
  trackEvent,
} from "../src/events";

/**
 * Custom events against stubbed browser globals: what reaches `/api/v1/track`, and above all what
 * does not — a rejected form, a repeat, a sensitive property.
 */

const CONTEXT: EventContext = { apiBase: "https://api.test", siteId: "rt_a", visitorId: "v-1" };
const PAGE = "https://acme.test/apply";

type Listener = (event: Record<string, unknown>) => void;

function targetMatching(...selectors: string[]) {
  return { closest: (selector: string) => (selectors.includes(selector) ? {} : null) };
}

function setup(online = true) {
  const sent: TrackBatch[] = [];
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const session = createMemoryStore();
  const local = createMemoryStore();
  const add = (map: Map<string, Listener[]>) => (type: string, fn: Listener) => {
    map.set(type, [...(map.get(type) ?? []), fn]);
  };

  vi.stubGlobal("navigator", {
    onLine: online,
    sendBeacon: (_url: string, blob: Blob) => {
      void blob.text().then((text) => sent.push(JSON.parse(text) as TrackBatch));
      return true;
    },
  });
  vi.stubGlobal("location", { href: PAGE });
  vi.stubGlobal("document", {
    addEventListener: add(documentListeners),
    querySelector: () => null,
    documentElement: {},
  });
  vi.stubGlobal("window", {
    addEventListener: add(windowListeners),
    sessionStorage: session,
    localStorage: local,
  });
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("localStorage", local);

  const emit = (map: Map<string, Listener[]>, type: string, event: Record<string, unknown>) => {
    for (const listener of map.get(type) ?? []) listener(event);
  };
  return {
    sent,
    session,
    local,
    documentListeners,
    click: (event: Record<string, unknown>) => emit(documentListeners, "click", event),
    submit: (event: Record<string, unknown>) => emit(windowListeners, "submit", event),
    dom: (type: string, event: Record<string, unknown>) => emit(documentListeners, type, event),
    settle: () => new Promise((resolve) => setTimeout(resolve, 5)),
  };
}

const click: EventTrigger = { name: "apply_clicked", kind: "click", selector: "#apply" };

beforeEach(() => resetEvents());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("trackEvent", () => {
  it("sends the name, url and properties, and names no experiment or arm", async () => {
    const t = setup();
    expect(trackEvent(CONTEXT, "purchase_completed", { value: 150, currency: "USD" })).toBe(true);
    await t.settle();

    const event = t.sent[0]!.events![0]!;
    expect(t.sent[0]).toMatchObject({ siteId: "rt_a", visitorId: "v-1" });
    expect(event).toMatchObject({
      name: "purchase_completed",
      url: PAGE,
      props: { value: 150, currency: "USD" },
    });
    expect(Object.keys(event)).not.toContain("experimentId");
    expect(Object.keys(event)).not.toContain("variantId");
  });

  it.each([["has space"], [""], ["-leading"], [42], [null], ["x".repeat(65)]])(
    "refuses the invalid name %j",
    async (name) => {
      const t = setup();
      expect(trackEvent(CONTEXT, name)).toBe(false);
      await t.settle();
      expect(t.sent).toHaveLength(0);
    },
  );

  it("treats a repeat within the burst window as one action, and a later one as a new one", async () => {
    const t = setup();
    expect(trackEvent(CONTEXT, "a", undefined, undefined, 1000)).toBe(true);
    expect(trackEvent(CONTEXT, "a", undefined, undefined, 1200)).toBe(false);
    expect(trackEvent(CONTEXT, "a", undefined, undefined, 2000)).toBe(true);
    await t.settle();
    expect(t.sent).toHaveLength(2);
    expect(t.sent[0]!.events![0]!.id).not.toBe(t.sent[1]!.events![0]!.id);
  });

  it("uses a caller's id, so a resend of the same order is recognised", async () => {
    const t = setup();
    trackEvent(CONTEXT, "purchase", undefined, { id: "order_42" });
    await t.settle();
    expect(t.sent[0]!.events![0]!.id).toBe("order_42");
  });

  it("holds an event while offline and resends it with the same id", async () => {
    const t = setup(false);
    trackEvent(CONTEXT, "a");
    await t.settle();
    expect(t.sent).toHaveLength(0);
    const held = JSON.parse(t.local.getItem("routely_evq")!) as { id: string }[];

    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    flushQueue(CONTEXT);
    await t.settle();
    expect(t.sent[0]!.events![0]!.id).toBe(held[0]!.id);
    expect(t.local.getItem("routely_evq")).toBeNull();
  });

  it("never throws when nothing can deliver or hold the event", () => {
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", undefined);
    vi.stubGlobal("location", { href: PAGE });
    expect(() => trackEvent(CONTEXT, "a")).not.toThrow();
  });
});

describe("safeProperties", () => {
  it("keeps flat business values", () => {
    expect(safeProperties({ value: 150, currency: "USD", gift: false, plan: "pro" })).toEqual({
      value: 150,
      currency: "USD",
      gift: false,
      plan: "pro",
    });
  });

  it.each([
    [{ email: "a@b.co" }],
    [{ user_email: "x" }],
    [{ password: "hunter2" }],
    [{ card_number: "1" }],
    [{ phone: "1" }],
    [{ first_name: "Sam" }],
    [{ note: "reach me at sam@acme.com" }],
    [{ ref: "4242 4242 4242 4242" }],
    [{ contact: "+1 (415) 555-2671" }],
    [{ nested: { a: 1 } }],
    [{ list: [1] }],
    [{ bad: Number.NaN }],
    [{ long: "x".repeat(201) }],
  ])("drops %j", (input) => {
    expect(safeProperties(input)).toBeUndefined();
  });

  it("stops at ten properties", () => {
    const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(safeProperties(many)!)).toHaveLength(10);
  });
});

describe("click triggers", () => {
  it("counts a click on an element inside the button, through closest()", async () => {
    const t = setup();
    startTriggers(CONTEXT, [click], PAGE);
    t.click({ target: targetMatching("#apply") });
    await t.settle();
    expect(t.sent[0]!.events![0]!.name).toBe("apply_clicked");
  });

  it("ignores clicks elsewhere, and a target with no closest()", async () => {
    const t = setup();
    startTriggers(CONTEXT, [click], PAGE);
    t.click({ target: targetMatching("#other") });
    t.click({ target: {} });
    await t.settle();
    expect(t.sent).toHaveLength(0);
  });

  it("attaches one listener however many triggers, and however often it starts", () => {
    const t = setup();
    const second: EventTrigger = { name: "b", kind: "click", selector: ".b" };
    startTriggers(CONTEXT, [click, second], PAGE);
    startTriggers(CONTEXT, [click, second], PAGE);
    expect(t.documentListeners.get("click")).toHaveLength(1);
  });

  it("honours a page limit", () => {
    const t = setup();
    const elsewhere: EventTrigger = {
      ...click,
      page: { url: "https://acme.test/other", match: "EXACT" },
    };
    startTriggers(CONTEXT, [elsewhere], PAGE);
    expect(t.documentListeners.get("click")).toBeUndefined();
  });

  it("does not let an unparsable selector throw into the page", () => {
    const t = setup();
    startTriggers(CONTEXT, [click], PAGE);
    const throwing = {
      closest: () => {
        throw new SyntaxError("bad selector");
      },
    };
    expect(() => t.click({ target: throwing })).not.toThrow();
  });
});

describe("form triggers", () => {
  const form: EventTrigger = { name: "lead", kind: "form", selector: "#f", success: "submit" };

  it("submit mode counts a submission nothing cancelled", async () => {
    const t = setup();
    startTriggers(CONTEXT, [form], PAGE);
    t.submit({ target: targetMatching("#f"), defaultPrevented: false });
    await t.settle();
    expect(t.sent[0]!.events![0]!.name).toBe("lead");
  });

  it("submit mode counts nothing for a cancelled submission, and reports why", async () => {
    const t = setup();
    startTriggers(CONTEXT, [form], PAGE);
    t.submit({ target: targetMatching("#f"), defaultPrevented: true });
    await t.settle();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.events).toBeUndefined();
    expect(t.sent[0]!.issues![0]).toMatchObject({ name: "lead", code: "form_ajax" });
  });

  it("success-page mode needs the submission and the page, and counts a reload once", async () => {
    const success: EventTrigger = {
      name: "lead",
      kind: "form",
      selector: "#f",
      success: "url",
      successUrl: { url: "https://acme.test/thanks", match: "EXACT" },
    };
    const thanks = "https://acme.test/thanks";

    // Reaching the page without submitting is not a submission.
    let t = setup();
    startTriggers(CONTEXT, [success], thanks);
    await t.settle();
    expect(t.sent).toHaveLength(0);

    // Submitting alone is not a success.
    resetEvents();
    t = setup();
    startTriggers(CONTEXT, [success], PAGE);
    t.submit({ target: targetMatching("#f"), defaultPrevented: true });
    await t.settle();
    expect(t.sent).toHaveLength(0);

    // Both, then a reload of the thank-you page.
    resetEvents();
    startTriggers(CONTEXT, [success], thanks);
    await t.settle();
    expect(t.sent).toHaveLength(1);
    resetEvents();
    startTriggers(CONTEXT, [success], thanks);
    await t.settle();
    expect(t.sent).toHaveLength(1);
  });

  it("plugin mode counts only the plugin's success event", async () => {
    const plugin: EventTrigger = {
      name: "lead",
      kind: "form",
      success: "callback",
      successEvent: "wpcf7mailsent",
    };
    const t = setup();
    startTriggers(CONTEXT, [plugin], PAGE);
    t.submit({ target: targetMatching("#f"), defaultPrevented: true });
    t.dom("wpcf7invalid", { target: targetMatching("#f") });
    await t.settle();
    expect(t.sent).toHaveLength(0);
    t.dom("wpcf7mailsent", { target: targetMatching("#f") });
    await t.settle();
    expect(t.sent[0]!.events![0]!.name).toBe("lead");
  });
});

describe("selector checks", () => {
  it("reports a selector missing from its page, once a page has had time to render", async () => {
    vi.useFakeTimers();
    const t = setup();
    startTriggers(CONTEXT, [{ ...click, check: PAGE }], PAGE);
    vi.advanceTimersByTime(3000);
    vi.useRealTimers();
    await t.settle();
    expect(t.sent[0]!.issues![0]).toMatchObject({ code: "selector_missing", url: PAGE });
  });

  it("says so when a flagged selector is back", async () => {
    vi.useFakeTimers();
    const t = setup();
    vi.stubGlobal("document", { ...document, querySelector: () => ({}) });
    startTriggers(CONTEXT, [{ ...click, check: PAGE, flagged: true }], PAGE);
    vi.advanceTimersByTime(3000);
    vi.useRealTimers();
    await t.settle();
    expect(t.sent[0]!.issues![0]!.code).toBe("selector_ok");
  });

  it("stays silent when the selector is present, and on any other page", async () => {
    vi.useFakeTimers();
    const t = setup();
    startTriggers(CONTEXT, [{ ...click, check: "https://acme.test/elsewhere" }], PAGE);
    vi.advanceTimersByTime(3000);
    vi.useRealTimers();
    await t.settle();
    expect(t.sent).toHaveLength(0);
  });
});
