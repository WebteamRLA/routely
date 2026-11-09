import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventTrigger } from "@routely/sdk/contract";
import {
  EVENT_TAG_MARK,
  type EventTagLook,
  buildGtmEventSnippet,
  containerHasEventTag,
  eventTagStatus,
} from "@/lib/gtm-event";

const SITE = "rt_0123456789abcdef0123456789abcdef";
const FORM_PAGE = "https://acme.test/contact";
const THANKS = "https://acme.test/thanks";

type Listener = (event: Record<string, unknown>) => void;

/** One element in a tiny tree: `closest()` matches `#id` selectors up the parents. */
interface FakeNode {
  id: string;
  parent: FakeNode | null;
  closest(selector: string): FakeNode | null;
}
function node(id: string, parent: FakeNode | null = null): FakeNode {
  const self: FakeNode = {
    id,
    parent,
    closest(selector) {
      for (let at: FakeNode | null = self; at; at = at.parent) {
        if (selector === `#${at.id}`) return at;
      }
      return null;
    },
  };
  return self;
}

/**
 * Runs the real generated tag on a stubbed page and returns handles to drive it. `routely` is the
 * page's Routely pixel: loaded (`track` records calls), or absent (the tag's queue holds them).
 */
function loadPage(
  trigger: EventTrigger,
  href: string,
  options: {
    session?: Map<string, string>;
    pixel?: "loaded" | "absent" | "other-project";
    successShown?: boolean;
  } = {},
) {
  const session = options.session ?? new Map<string, string>();
  const onDocument: Record<string, Listener[]> = {};
  const onWindow: Record<string, Listener[]> = {};
  const tracked: unknown[][] = [];
  let successShown = options.successShown ?? false;
  const observers = new Set<{ cb: () => void }>();

  class FakeObserver {
    constructor(public cb: () => void) {}
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  }

  const document = {
    documentElement: {},
    addEventListener: (type: string, fn: Listener) => (onDocument[type] ??= []).push(fn),
    querySelector: (selector: string) =>
      selector === "#thanks-message" ? { getClientRects: () => (successShown ? [{}] : []) } : null,
  };
  const pixel = options.pixel ?? "loaded";
  const window: Record<string, unknown> = {
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => void session.set(key, String(value)),
    },
    addEventListener: (type: string, fn: Listener) => (onWindow[type] ??= []).push(fn),
    MutationObserver: FakeObserver,
    ...(pixel === "absent"
      ? {}
      : {
          routely: {
            isLoaded: true,
            siteId: pixel === "loaded" ? SITE : "rt_ffffffffffffffffffffffffffffffff",
            track: (...args: unknown[]) => tracked.push(args),
          },
        }),
  };

  const code = buildGtmEventSnippet({ publicSiteId: SITE, trigger });
  const inner = code.replace(/^[\s\S]*?<script>/, "").replace(/<\/script>\s*$/, "");
  const start = () =>
    new Function("window", "document", "location", "MutationObserver", "setTimeout", inner)(
      window,
      document,
      { href },
      FakeObserver,
      () => 0,
    );
  start();

  return {
    tracked,
    window,
    session,
    /** Runs the same tag again, as a second Tag Manager trigger would. */
    again: start,
    click: (target: FakeNode) => onDocument["click"]?.forEach((fn) => fn({ target })),
    submit: (target: FakeNode, prevented = false) =>
      onWindow["submit"]?.forEach((fn) => fn({ target, defaultPrevented: prevented })),
    showSuccess: () => {
      successShown = true;
      for (const observer of [...observers]) observer.cb();
    },
    announce: (type: string, target: unknown) => onDocument[type]?.forEach((fn) => fn({ target })),
    document,
  };
}

const click = (over: Partial<EventTrigger> = {}): EventTrigger => ({
  name: "apply_clicked",
  kind: "click",
  selector: "#apply",
  ...over,
});
const form = (over: Partial<EventTrigger>): EventTrigger => ({
  name: "lead_sent",
  kind: "form",
  selector: "#lead",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the Tag Manager event tag: element click", () => {
  const button = node("apply");
  const icon = node("icon", button);

  it("reports a click on the element, or on anything inside it, through routely.track", () => {
    const page = loadPage(click(), FORM_PAGE);
    page.click(icon);
    expect(page.tracked).toEqual([["apply_clicked", null, null]]);
  });

  it("reports every real click, and a double click once", () => {
    const page = loadPage(click(), FORM_PAGE);
    page.click(button);
    page.click(button); // the same moment: one action
    vi.advanceTimersByTime(600);
    page.click(button);
    expect(page.tracked).toHaveLength(2);
  });

  it("ignores other elements, and pages the event is limited away from", () => {
    const page = loadPage(click(), FORM_PAGE);
    page.click(node("elsewhere"));
    expect(page.tracked).toEqual([]);

    const limited = loadPage(
      click({ page: { url: "https://acme.test/pricing", match: "EXACT" } }),
      FORM_PAGE,
    );
    limited.click(button);
    expect(limited.tracked).toEqual([]);

    const prefix = loadPage(
      click({ page: { url: "http://ACME.test/pricing/", match: "PREFIX" } }),
      "https://acme.test/pricing/annual?utm_source=ad#top",
    );
    prefix.click(button);
    expect(prefix.tracked).toHaveLength(1);
  });

  it("listens once even when Tag Manager fires the tag twice", () => {
    const page = loadPage(click(), FORM_PAGE);
    page.again();
    page.click(button);
    expect(page.tracked).toHaveLength(1);
  });
});

describe("the Tag Manager event tag: form submission", () => {
  const leadForm = node("lead");

  it("counts a submit no script cancelled, and never a cancelled or failed one", () => {
    const page = loadPage(form({ success: "submit" }), FORM_PAGE);
    page.submit(leadForm, true);
    expect(page.tracked).toEqual([]);
    page.submit(node("newsletter"));
    expect(page.tracked).toEqual([]);
    page.submit(leadForm);
    expect(page.tracked).toEqual([["lead_sent", null, null]]);
  });

  it("success page: counts the success page only after this form was sent in this tab", () => {
    const trigger = form({ success: "url", successUrl: { url: THANKS, match: "EXACT" } });
    const session = new Map<string, string>();

    // Straight to the thank-you page, no form sent: nothing.
    expect(loadPage(trigger, THANKS, { session }).tracked).toEqual([]);

    // The form page remembers the submit; the success page counts it once, with a stable id.
    const formPage = loadPage(trigger, FORM_PAGE, { session });
    formPage.submit(leadForm);
    expect(formPage.tracked).toEqual([]);
    const sentAt = Date.now();
    vi.advanceTimersByTime(2000);
    const thanks = loadPage(trigger, `${THANKS}/?utm_source=x`, { session });
    expect(thanks.tracked).toEqual([["lead_sent", null, { id: `gtm-${sentAt}` }]]);

    // A reload of the success page is not a second submission.
    expect(loadPage(trigger, THANKS, { session }).tracked).toEqual([]);
  });

  it("success page: a submission older than 30 minutes does not count", () => {
    const trigger = form({ success: "url", successUrl: { url: THANKS, match: "EXACT" } });
    const session = new Map<string, string>();
    loadPage(trigger, FORM_PAGE, { session }).submit(leadForm);
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(loadPage(trigger, THANKS, { session }).tracked).toEqual([]);
  });

  it("success page with no form chosen: the first visit in a session counts", () => {
    const trigger = form({
      selector: undefined,
      success: "url",
      successUrl: { url: THANKS, match: "EXACT" },
    });
    const session = new Map<string, string>();
    expect(loadPage(trigger, THANKS, { session }).tracked).toHaveLength(1);
    expect(loadPage(trigger, THANKS, { session }).tracked).toEqual([]);
  });

  it("success message: counts when the message appears after a submit, not before or without one", () => {
    const trigger = form({ success: "element", successSelector: "#thanks-message" });

    const page = loadPage(trigger, FORM_PAGE);
    page.showSuccess(); // no submit: not watched
    expect(page.tracked).toEqual([]);

    const sent = loadPage(trigger, FORM_PAGE);
    sent.submit(leadForm);
    expect(sent.tracked).toEqual([]);
    sent.showSuccess();
    expect(sent.tracked).toEqual([["lead_sent", null, null]]);

    // Already showing before the submit (it isn't a success message then): nothing.
    const always = loadPage(trigger, FORM_PAGE, { successShown: true });
    always.submit(leadForm);
    expect(always.tracked).toEqual([]);
  });

  it("form plugin: counts the plugin's success event", () => {
    const trigger = form({
      selector: undefined,
      success: "callback",
      successEvent: "wpcf7mailsent",
    });
    const page = loadPage(trigger, FORM_PAGE);
    page.announce("wpcf7mailsent", page.document);
    expect(page.tracked).toHaveLength(1);
  });
});

describe("the Tag Manager event tag: never counted twice, never lost", () => {
  const button = node("apply");
  const config = (names: string[]) =>
    JSON.stringify({
      expiresAt: Date.now() + 60_000,
      config: { events: names.map((name) => ({ name })) },
    });

  it("stands down while the pixel's configuration lists the event (it was switched back to the pixel)", () => {
    const session = new Map([[`routely_cfg_${SITE}`, config(["apply_clicked"])]]);
    const page = loadPage(click(), FORM_PAGE, { session });
    page.click(button);
    expect(page.tracked).toEqual([]);

    const other = loadPage(click(), FORM_PAGE, {
      session: new Map([[`routely_cfg_${SITE}`, config(["something_else"])]]),
    });
    other.click(button);
    expect(other.tracked).toHaveLength(1);
  });

  it("leaves a success page to the pixel without using up the submission", () => {
    const trigger = form({ success: "url", successUrl: { url: THANKS, match: "EXACT" } });
    const session = new Map([
      [`routely_cfg_${SITE}`, config(["lead_sent"])],
      ["routely_sub_lead_sent", String(Date.now())],
    ]);
    expect(loadPage(trigger, THANKS, { session }).tracked).toEqual([]);
    // The pixel's own success-page check still finds the submission.
    expect(Number(session.get("routely_sub_lead_sent"))).toBeGreaterThan(0);
  });

  it("queues the event until the Routely script loads, as routely.track's own queue", () => {
    const page = loadPage(click(), FORM_PAGE, { pixel: "absent" });
    page.click(button);
    const routely = page.window["routely"] as { q: ArrayLike<unknown>[] };
    expect(routely.q.map((args) => Array.from(args))).toEqual([["apply_clicked", null, null]]);
  });

  it("sends nothing through another project's Routely script", () => {
    const page = loadPage(click(), FORM_PAGE, { pixel: "other-project" });
    page.click(button);
    expect(page.tracked).toEqual([]);
  });
});

describe("buildGtmEventSnippet", () => {
  it("carries the project id and the event's settings as data, in plain ES5", () => {
    const code = buildGtmEventSnippet({ publicSiteId: SITE, trigger: click() });
    expect(code).toContain(`var site = "${SITE}";`);
    expect(code).toContain(`"name":"apply_clicked"`);
    expect(code).toContain(EVENT_TAG_MARK);
    expect(code).not.toMatch(/=>|\bconst\b|\blet\b|`/);
  });

  it("cannot be closed early by a value", () => {
    const code = buildGtmEventSnippet({
      publicSiteId: SITE,
      trigger: click({ selector: "a[title='</script><b>']" }),
    });
    expect(code.match(/<\/script>/g)).toHaveLength(1);
  });

  it("leaves out what the pixel uses only for its own checks", () => {
    const code = buildGtmEventSnippet({
      publicSiteId: SITE,
      trigger: click({ check: "https://acme.test/", flagged: true }),
    });
    expect(code).not.toContain("flagged");
    expect(code).not.toContain('"check"');
  });
});

describe("containerHasEventTag", () => {
  const code = buildGtmEventSnippet({ publicSiteId: SITE, trigger: click() });

  it("finds the tag in a published container, however Tag Manager escaped it", () => {
    expect(containerHasEventTag(`{"vtp_html":${JSON.stringify(code)}}`, "apply_clicked")).toBe(
      true,
    );
    const hex = code.replace(/"/g, "\\x22");
    expect(containerHasEventTag(hex, "apply_clicked")).toBe(true);
    const unicode = code.replace(/"/g, "\\u0022");
    expect(containerHasEventTag(unicode, "apply_clicked")).toBe(true);
  });

  it("does not take another event's tag, or a stray name, for this one", () => {
    expect(containerHasEventTag(code, "apply")).toBe(false);
    expect(containerHasEventTag(code, "apply_clicked2")).toBe(false);
    expect(containerHasEventTag(`"name":"apply_clicked"`, "apply_clicked")).toBe(false);
  });
});

describe("eventTagStatus", () => {
  const look = (over: Partial<EventTagLook>): EventTagLook => ({
    pageLoaded: true,
    loadError: null,
    refused: null,
    containers: ["GTM-ABC123"],
    unreadable: false,
    tagPublished: true,
    pixelFound: true,
    ...over,
  });

  it("says what is missing, in order", () => {
    expect(eventTagStatus(look({ pageLoaded: false, loadError: "HTTP 404" })).title).toBe(
      "Couldn’t load that page",
    );
    expect(eventTagStatus(look({ containers: [] })).title).toBe(
      "No Google Tag Manager on this page",
    );
    expect(eventTagStatus(look({ tagPublished: false })).title).toBe(
      "This event’s tag isn’t published",
    );
    expect(eventTagStatus(look({ tagPublished: false, unreadable: true })).tone).toBe("warn");
    expect(eventTagStatus(look({ pixelFound: false })).title).toBe(
      "Tag published, Routely script missing",
    );
    expect(eventTagStatus(look({})).tone).toBe("ok");
  });
});
