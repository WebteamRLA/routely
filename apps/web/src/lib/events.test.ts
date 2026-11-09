import { describe, expect, it } from "vitest";

import {
  EVENT_ACTIVE_WINDOW_MS,
  EVENT_TEMPLATES,
  type EventSignals,
  type TriggerSource,
  clickTrackSnippet,
  eventStatus,
  submissionUnverified,
  toEventTrigger,
  trackSnippet,
} from "@/lib/events";
import { EVENT_NAME_PATTERN } from "@routely/sdk/contract";

const NOW = new Date("2026-11-05T10:00:00Z");

const signals = (over: Partial<EventSignals> = {}): EventSignals => ({
  method: "CLICK",
  formSuccess: null,
  issueCode: null,
  total: 0,
  lastReceivedAt: null,
  ...over,
});

describe("eventStatus", () => {
  it("never reads as working on a name alone", () => {
    expect(eventStatus(signals(), NOW).state).toBe("not_detected");
  });

  it("is active inside the window, inactive past it, by the stated rule", () => {
    const inside = new Date(NOW.getTime() - EVENT_ACTIVE_WINDOW_MS);
    const past = new Date(NOW.getTime() - EVENT_ACTIVE_WINDOW_MS - 1);
    expect(eventStatus(signals({ lastReceivedAt: inside }), NOW).state).toBe("active");
    expect(eventStatus(signals({ lastReceivedAt: past }), NOW).state).toBe("inactive");
  });

  it("puts a configuration problem above everything", () => {
    const status = eventStatus(
      signals({ issueCode: "selector_missing", lastReceivedAt: NOW, total: 9 }),
      NOW,
    );
    expect(status.state).toBe("config_error");
    expect(status.note).toContain("couldn’t find");
  });
});

describe("submissionUnverified", () => {
  it("is true only for a form confirmed by its submit alone", () => {
    expect(submissionUnverified("FORM", "SUBMIT")).toBe(true);
    expect(submissionUnverified("FORM", "URL")).toBe(false);
    expect(submissionUnverified("CLICK", null)).toBe(false);
  });
});

describe("toEventTrigger", () => {
  const source = (over: Partial<TriggerSource>): TriggerSource => ({
    name: "e",
    method: "CLICK",
    selector: "#a",
    pageUrl: null,
    pageMatch: null,
    formSuccess: null,
    successUrl: null,
    successMatch: "EXACT",
    successSelector: null,
    successEvent: null,
    issueCode: null,
    ...over,
  });

  it("projects a click, limiting it only when asked", () => {
    expect(toEventTrigger(source({}))).toEqual({ name: "e", selector: "#a", kind: "click" });
    expect(
      toEventTrigger(source({ pageUrl: "https://a.test/x", pageMatch: "EXACT" })),
    ).toMatchObject({
      page: { url: "https://a.test/x", match: "EXACT" },
      check: "https://a.test/x",
    });
  });

  it("checks the picked page without limiting listening to it", () => {
    const trigger = toEventTrigger(source({ pageUrl: "https://a.test/x" }));
    expect(trigger?.check).toBe("https://a.test/x");
    expect(trigger?.page).toBeUndefined();
  });

  it("publishes nothing for code events and incomplete rows", () => {
    expect(toEventTrigger(source({ method: "CODE" }))).toBeNull();
    expect(toEventTrigger(source({ selector: null }))).toBeNull();
    expect(toEventTrigger(source({ method: "FORM" }))).toBeNull();
    expect(toEventTrigger(source({ method: "FORM", formSuccess: "URL" }))).toBeNull();
  });

  it("projects each form confirmation", () => {
    const form = { method: "FORM" as const };
    expect(toEventTrigger(source({ ...form, formSuccess: "SUBMIT" }))?.success).toBe("submit");
    expect(
      toEventTrigger(source({ ...form, formSuccess: "URL", successUrl: "https://a.test/t" }))
        ?.successUrl,
    ).toEqual({ url: "https://a.test/t", match: "EXACT" });
    expect(
      toEventTrigger(source({ ...form, formSuccess: "ELEMENT", successSelector: ".ok" }))
        ?.successSelector,
    ).toBe(".ok");
    expect(
      toEventTrigger(source({ ...form, formSuccess: "CALLBACK", successEvent: "wpcf7mailsent" }))
        ?.successEvent,
    ).toBe("wpcf7mailsent");
  });

  it("flags a selector reported missing, so the SDK can say when it is back", () => {
    expect(toEventTrigger(source({ issueCode: "selector_missing" }))?.flagged).toBe(true);
  });
});

describe("templates", () => {
  it("are all valid names", () => {
    for (const template of EVENT_TEMPLATES) {
      expect(template.name).toMatch(EVENT_NAME_PATTERN);
    }
  });
});

describe("trackSnippet", () => {
  it("is safe before the SDK loads and with the SDK blocked", () => {
    const code = trackSnippet("signup_completed");
    const window: { routely?: { q: unknown[]; track(...args: unknown[]): void } } = {};
    new Function("window", code)(window);
    expect(window.routely?.q).toHaveLength(1);
    expect(Array.from(window.routely?.q[0] as ArrayLike<unknown>)).toEqual(["signup_completed"]);
  });

  it("escapes the name", () => {
    expect(trackSnippet(`a"b`)).toContain(`"a\\"b"`);
  });
});

describe("clickTrackSnippet", () => {
  /** Runs the snippet against a stub page; returns the click handler and what was tracked. */
  function load(code: string, routely?: { track: (...args: unknown[]) => void }) {
    let onClick: (e: { target: unknown }) => void = () => {};
    const window: Record<string, unknown> = routely ? { routely } : {};
    const document = { addEventListener: (_t: string, fn: typeof onClick) => (onClick = fn) };
    const inner = code.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    new Function("window", "document", inner)(window, document);
    return { click: (target: unknown) => onClick({ target }), window };
  }
  const inside = (match: boolean) => ({
    closest: (s: string) => (match && s === "#buy" ? {} : null),
  });

  it("reports clicks on the chosen element through routely.track, and ignores others", () => {
    const tracked: unknown[][] = [];
    const page = load(clickTrackSnippet("buy_clicked", "#buy"), {
      track: (...args) => tracked.push(args),
    });
    page.click(inside(true));
    page.click(inside(false));
    expect(tracked).toEqual([["buy_clicked"]]);
  });

  it("queues the click until the Routely script loads", () => {
    const page = load(clickTrackSnippet("buy_clicked", "#buy"));
    page.click(inside(true));
    const routely = page.window["routely"] as { q: ArrayLike<unknown>[] };
    expect(routely.q.map((args) => Array.from(args))).toEqual([["buy_clicked"]]);
  });

  it("cannot be closed early by a selector", () => {
    const code = clickTrackSnippet("x", "a[title='</script>']");
    expect(code.match(/<\/script>/g)).toHaveLength(1);
  });
});
