import { afterEach, describe, expect, it, vi } from "vitest";

import { SDK_PROTOCOL_VERSION } from "../src/contract";
import { createMemoryStore } from "../src/env";
import { claimHit, hashUrl, sendHit, utcDay } from "../src/hit";

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("claimHit", () => {
  it("claims a URL once per UTC day", () => {
    const store = createMemoryStore();
    expect(claimHit("rt_a", "https://acme.test/a", store, NOW)).toBe(true);
    expect(claimHit("rt_a", "https://acme.test/a", store, NOW + 1000)).toBe(false);
    expect(claimHit("rt_a", "https://acme.test/b", store, NOW)).toBe(true);
    // A different project's snippet on the same page is a different hit.
    expect(claimHit("rt_b", "https://acme.test/a", store, NOW)).toBe(true);
    expect(claimHit("rt_b", "https://acme.test/a", store, NOW)).toBe(false);
  });

  it("claims again on the next UTC day and forgets the previous one", () => {
    const store = createMemoryStore();
    claimHit("rt_a", "https://acme.test/a", store, NOW);
    expect(claimHit("rt_a", "https://acme.test/a", store, NOW + DAY)).toBe(true);
    expect(JSON.parse(store.getItem("routely_hits")!).u).toHaveLength(1);
  });

  it("uses the UTC day, not the local one", () => {
    expect(utcDay(Date.UTC(2026, 9, 19, 23, 59))).toBe("2026-10-19");
    expect(utcDay(Date.UTC(2026, 9, 20, 0, 1))).toBe("2026-10-20");
  });

  it("always claims without storage, and survives junk in it", () => {
    expect(claimHit("rt_a", "https://acme.test/a", null, NOW)).toBe(true);
    const store = createMemoryStore();
    store.setItem("routely_hits", "{not json");
    expect(claimHit("rt_a", "https://acme.test/a", store, NOW)).toBe(true);
    expect(claimHit("rt_a", "https://acme.test/a", store, NOW)).toBe(false);
  });

  it("survives storage that throws", () => {
    const store = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    expect(claimHit("rt_a", "https://acme.test/a", store, NOW)).toBe(true);
  });

  it("hashes deterministically", () => {
    expect(hashUrl("https://acme.test/a")).toBe(hashUrl("https://acme.test/a"));
    expect(hashUrl("https://acme.test/a")).not.toBe(hashUrl("https://acme.test/b"));
  });
});

describe("sendHit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("beacons the normalised URL once per day", async () => {
    const beacon = vi.fn((_url: string, _body: Blob) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    const store = createMemoryStore();

    const href = "https://ACME.test/pricing/?utm_source=ads#plans";
    expect(sendHit("https://api.test", "rt_abc", "visitor-1234", href, store, NOW)).toBe(true);
    expect(sendHit("https://api.test", "rt_abc", "visitor-1234", href, store, NOW)).toBe(false);

    expect(beacon).toHaveBeenCalledOnce();
    expect(beacon.mock.calls[0]![0]).toBe("https://api.test/api/v1/hit");
    const body = JSON.parse(await beacon.mock.calls[0]![1].text());
    expect(body).toEqual({
      v: SDK_PROTOCOL_VERSION,
      siteId: "rt_abc",
      anonymousId: "visitor-1234",
      url: "https://acme.test/pricing",
      ts: NOW,
    });
  });

  it("sends nothing for a URL that is not http(s)", () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    expect(sendHit("https://api.test", "rt_abc", "v", "file:///x", createMemoryStore(), NOW)).toBe(
      false,
    );
    expect(beacon).not.toHaveBeenCalled();
  });

  it("never throws when no transport exists", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("fetch", undefined);
    expect(() =>
      sendHit("https://api.test", "rt_abc", "v", "https://acme.test/", createMemoryStore(), NOW),
    ).not.toThrow();
  });
});
