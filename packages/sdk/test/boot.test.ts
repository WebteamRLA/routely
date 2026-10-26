import { afterEach, describe, expect, it, vi } from "vitest";

import { assignmentKey } from "../src/assignment";
import type { AssignResponse, ConfigResponse, ExperimentConfig } from "../src/contract";
import { resetPageViewGuard } from "../src/dedupe";
import { createMemoryStore } from "../src/env";
import { boot } from "../src/index";
import { FakeElement } from "./fake-dom";

/**
 * The boot sequence end to end, against stubbed browser globals: which branch runs for an A/B
 * test, a device-targeted test and the editor, and what reaches the network in each.
 */

const PAGE = "https://acme.test/";
const API = "https://api.test";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";

const AB: ExperimentConfig = {
  id: "exp_ab",
  kind: "ab_test",
  devices: [],
  control: { url: PAGE, match: "EXACT" },
  controlWeight: 0,
  variants: [
    {
      id: "var_a",
      weight: 100,
      changes: [{ selector: "#hero", kind: "heading", set: { text: "Variant heading" } }],
    },
  ],
  goal: { url: "https://acme.test/thanks", match: "EXACT" },
  trafficAllocation: 100,
};

interface Setup {
  href?: string;
  experiments?: ExperimentConfig[];
  ua?: string;
  framedBy?: { postMessage: (...args: unknown[]) => void };
  /** What `POST /api/v1/assign` answers; null is "not entered". Default: the first variant. */
  assign?: AssignResponse | null;
  /** Storage carried over from an earlier page load (a refresh, a return visit). */
  localStorage?: ReturnType<typeof createMemoryStore>;
}

function setup({
  href = PAGE,
  experiments = [AB],
  ua = DESKTOP_UA,
  framedBy,
  assign = { variantId: experiments[0]?.variants[0]?.id ?? null },
  localStorage = createMemoryStore(),
}: Setup = {}) {
  // Each setup is a new page load, so a new bundle instance: no page view reported yet.
  resetPageViewGuard();
  const hero = new FakeElement("h1");
  hero.textContent = "Original heading";
  const reveal = vi.fn();
  const beacons: { url: string; body: Blob }[] = [];
  const config: ConfigResponse = { v: 4, siteId: "rt_abc", ttl: 60, experiments };
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/api/v1/assign")
      ? { ok: assign !== null, json: async () => assign }
      : { ok: true, json: async () => config },
  );
  const assignCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/v1/assign")).length;

  const script = { dataset: { siteId: "rt_abc", api: API } };
  const win: Record<string, unknown> = {
    location: { href, protocol: "https:", replace: vi.fn() },
    localStorage,
    sessionStorage: createMemoryStore(),
    __routelyReveal: reveal,
    opener: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: vi.fn(),
  };
  win.parent = framedBy ?? win;

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    currentScript: script,
    readyState: "complete",
    visibilityState: "visible",
    cookie: "",
    querySelector: (selector: string) => (selector === "#hero" ? hero : null),
    addEventListener: vi.fn(),
  });
  vi.stubGlobal("navigator", {
    userAgent: ua,
    sendBeacon: (url: string, body: Blob) => beacons.push({ url, body }) > 0,
  });
  vi.stubGlobal("history", { state: null, replaceState: vi.fn() });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("addEventListener", vi.fn());

  return { hero, reveal, beacons, fetchMock, win, assignCalls, localStorage };
}

const sentTo = (beacons: { url: string }[], path: string) =>
  beacons.filter((beacon) => beacon.url === API + path);

describe("boot", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies an A/B variant's changes, reports, and reveals once applied", async () => {
    const page = setup();
    const state = await boot();

    expect(state?.action).toBe("apply");
    expect(state?.assignment).toEqual({ experimentId: "exp_ab", variantId: "var_a" });
    expect(state?.applied).toEqual({ applied: 1, total: 1 });
    expect(page.hero.textContent).toBe("Variant heading");
    expect(page.reveal).toHaveBeenCalled();
    expect(
      (page.win.location as { replace: ReturnType<typeof vi.fn> }).replace,
    ).not.toHaveBeenCalled();

    expect(sentTo(page.beacons, "/api/v1/events")).toHaveLength(1);
    expect(sentTo(page.beacons, "/api/v1/hit")).toHaveLength(1);
    expect(String(page.fetchMock.mock.calls[0]![0])).toContain("&v=4");
  });

  it("leaves an A/B control visitor's page untouched and reveals at once", async () => {
    const page = setup({ assign: { variantId: null } });
    const state = await boot();
    expect(state?.action).toBe("stay");
    expect(state?.assignment?.variantId).toBeNull();
    expect(page.hero.textContent).toBe("Original heading");
    expect(page.reveal).toHaveBeenCalled();
  });

  it("does not enter a visitor on an untargeted device", async () => {
    const page = setup({ experiments: [{ ...AB, devices: ["desktop"] }], ua: PHONE_UA });
    const state = await boot();
    expect(state?.device).toBe("mobile");
    expect(state?.action).toBe("skip");
    expect(state?.assignment).toBeNull();
    expect(page.hero.textContent).toBe("Original heading");
    expect(sentTo(page.beacons, "/api/v1/events")).toHaveLength(0);
    // The site-wide hit is independent of experiments.
    expect(sentTo(page.beacons, "/api/v1/hit")).toHaveLength(1);
    expect(page.reveal).toHaveBeenCalled();
  });

  it("still redirects a split-URL test from a v3-shaped experiment", async () => {
    const page = setup({
      experiments: [
        {
          id: "exp_split",
          control: { url: PAGE, match: "EXACT" },
          controlWeight: 0,
          variants: [{ id: "var_1", url: "https://acme.test/v2", weight: 100 }],
          goal: { url: "https://acme.test/thanks", match: "EXACT" },
          trafficAllocation: 100,
        },
      ],
    });
    const state = await boot();
    expect(state?.action).toBe("redirect");
    const replace = (page.win.location as { replace: ReturnType<typeof vi.fn> }).replace;
    expect(String(replace.mock.calls[0]![0])).toContain("https://acme.test/v2?_rt_vid=");
  });

  it("in the editor, only starts the bridge: no hit, no config, no events", async () => {
    const app = { postMessage: vi.fn() };
    const page = setup({ href: `${PAGE}#_rt_edit=tok_abcdefghijklmnop`, framedBy: app });
    const state = await boot();

    expect(state).toBeNull();
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(page.beacons).toHaveLength(0);
    expect(page.reveal).toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "routely:hello" }),
      API,
    );
  });

  it("ignores the editor fragment in a top-level tab and runs normally", async () => {
    const page = setup({ href: `${PAGE}#_rt_edit=tok_abcdefghijklmnop` });
    const state = await boot();
    expect(state?.action).toBe("apply");
    expect(page.fetchMock).toHaveBeenCalled();
  });

  it("takes the arm from the server once, and reports no assignment event of its own", async () => {
    const page = setup();
    await boot();
    expect(page.assignCalls()).toBe(1);
    // The server recorded the assignment when it chose it; the page view is all that is sent.
    const [events] = sentTo(page.beacons, "/api/v1/events");
    const body = JSON.parse(await events!.body.text()) as { events: { type: string }[] };
    expect(body.events.map((event) => event.type)).toEqual(["page_view"]);
  });

  it("keeps a returning visitor on their original version without asking the server", async () => {
    const localStorage = createMemoryStore();
    localStorage.setItem(
      assignmentKey(AB.id),
      JSON.stringify({ variantId: null, at: 1, sent: true }),
    );
    // The server would now say the variant — it is never asked.
    const page = setup({ localStorage, assign: { variantId: "var_a" } });
    const state = await boot();
    expect(page.assignCalls()).toBe(0);
    expect(state?.assignment).toEqual({ experimentId: AB.id, variantId: null });
    expect(page.hero.textContent).toBe("Original heading");
  });

  it("asks once across refreshes: later page loads read the stored arm", async () => {
    const localStorage = createMemoryStore();
    let asked = 0;
    for (let load = 0; load < 4; load += 1) {
      const page = setup({ localStorage });
      const state = await boot();
      asked += page.assignCalls();
      expect(state?.assignment).toEqual({ experimentId: AB.id, variantId: "var_a" });
      vi.unstubAllGlobals();
    }
    expect(asked).toBe(1);
  });

  it("does not enter a visitor the server could not assign: page untouched, nothing reported", async () => {
    const page = setup({ assign: null });
    const state = await boot();
    expect(state?.action).toBe("skip");
    expect(state?.assignment).toBeNull();
    expect(page.hero.textContent).toBe("Original heading");
    expect(sentTo(page.beacons, "/api/v1/events")).toHaveLength(0);
    expect(page.reveal).toHaveBeenCalled();
    expect(page.localStorage.getItem(assignmentKey(AB.id))).toBeNull();
  });

  it("does not ask for an arm for a visitor opening a variant page directly", async () => {
    const split: ExperimentConfig = {
      id: "exp_split",
      control: { url: "https://acme.test/", match: "PREFIX" },
      controlWeight: 50,
      variants: [{ id: "var_1", url: "https://acme.test/v2", weight: 50 }],
      goal: { url: "https://acme.test/thanks", match: "EXACT" },
      trafficAllocation: 100,
    };
    const page = setup({ href: "https://acme.test/v2", experiments: [split] });
    const state = await boot();
    expect(state?.action).toBe("skip");
    expect(page.assignCalls()).toBe(0);
    expect(state?.assignment).toBeNull();
  });
});
