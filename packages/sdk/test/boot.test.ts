import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigResponse, ExperimentConfig } from "../src/contract";
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
}

function setup({ href = PAGE, experiments = [AB], ua = DESKTOP_UA, framedBy }: Setup = {}) {
  const hero = new FakeElement("h1");
  hero.textContent = "Original heading";
  const reveal = vi.fn();
  const beacons: { url: string; body: Blob }[] = [];
  const config: ConfigResponse = { v: 4, siteId: "rt_abc", ttl: 60, experiments };
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => config }));

  const script = { dataset: { siteId: "rt_abc", api: API } };
  const win: Record<string, unknown> = {
    location: { href, protocol: "https:", replace: vi.fn() },
    localStorage: createMemoryStore(),
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

  return { hero, reveal, beacons, fetchMock, win };
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
    const page = setup({
      experiments: [{ ...AB, controlWeight: 100, variants: [{ ...AB.variants[0]!, weight: 0 }] }],
    });
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
});
