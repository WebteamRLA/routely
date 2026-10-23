import { describe, expect, it } from "vitest";

import {
  cacheKey,
  configUrl,
  isConfigResponse,
  readCachedConfig,
  writeCachedConfig,
} from "../src/config";
import type { ConfigResponse } from "../src/contract";
import { createMemoryStore } from "../src/env";

const VALID: ConfigResponse = {
  v: 3,
  siteId: "rt_abc",
  ttl: 60,
  experiments: [
    {
      id: "exp_1",
      control: { url: "https://acme.test/pricing", match: "EXACT" },
      controlWeight: 50,
      variants: [{ id: "var_1", url: "https://acme.test/pricing-v2", weight: 50 }],
      goal: { url: "https://acme.test/thanks", match: "EXACT" },
      trafficAllocation: 100,
    },
  ],
};

describe("isConfigResponse", () => {
  it("accepts a well-formed payload", () => {
    expect(isConfigResponse(VALID)).toBe(true);
  });

  it("rejects a payload from a different protocol version", () => {
    expect(isConfigResponse({ ...VALID, v: 1 })).toBe(false);
  });

  it("rejects an experiment with no variants", () => {
    expect(
      isConfigResponse({ ...VALID, experiments: [{ ...VALID.experiments[0], variants: [] }] }),
    ).toBe(false);
  });

  it("rejects anything that is not a config", () => {
    for (const value of [null, undefined, 42, "ok", [], {}, { experiments: "no" }]) {
      expect(isConfigResponse(value)).toBe(false);
    }
  });

  it("rejects a payload with a malformed experiment", () => {
    expect(isConfigResponse({ ...VALID, experiments: [{ id: "exp_1" }] })).toBe(false);
  });
});

describe("config cache", () => {
  it("returns a config written within its TTL", () => {
    const store = createMemoryStore();
    writeCachedConfig("rt_abc", VALID, store, 1_000);

    expect(readCachedConfig("rt_abc", store, 30_000)).toEqual(VALID);
  });

  it("ignores a config past its TTL, so a pause propagates", () => {
    const store = createMemoryStore();
    writeCachedConfig("rt_abc", VALID, store, 1_000);

    // ttl is 60s, so anything after 61_000 is stale.
    expect(readCachedConfig("rt_abc", store, 62_000)).toBeNull();
  });

  it("caps an implausible server TTL", () => {
    const store = createMemoryStore();
    writeCachedConfig("rt_abc", { ...VALID, ttl: 999_999 }, store, 0);

    // Capped at 600s, so an hour later it must be stale rather than pinned.
    expect(readCachedConfig("rt_abc", store, 3_600_000)).toBeNull();
  });

  it("keeps each site's config separate", () => {
    const store = createMemoryStore();
    writeCachedConfig("rt_abc", VALID, store, 0);

    expect(readCachedConfig("rt_other", store, 1_000)).toBeNull();
    expect(cacheKey("rt_abc")).not.toBe(cacheKey("rt_other"));
  });

  it("ignores corrupted cache entries instead of throwing", () => {
    const store = createMemoryStore();
    store.setItem(cacheKey("rt_abc"), "{not json");

    expect(() => readCachedConfig("rt_abc", store, 0)).not.toThrow();
    expect(readCachedConfig("rt_abc", store, 0)).toBeNull();
  });

  it("does nothing when no store is available", () => {
    expect(() => writeCachedConfig("rt_abc", VALID, null)).not.toThrow();
    expect(readCachedConfig("rt_abc", null)).toBeNull();
  });
});

describe("protocol v4", () => {
  const V4 = {
    ...VALID,
    v: 4,
    experiments: [
      { ...VALID.experiments[0], kind: "split_url", devices: [], keepParams: true },
      {
        id: "exp_ab",
        kind: "ab_test",
        devices: ["desktop", "tablet"],
        control: { url: "https://acme.test/", match: "EXACT" },
        controlWeight: 50,
        variants: [
          {
            id: "var_a",
            weight: 50,
            url: null,
            changes: [{ selector: "#hero", kind: "heading", set: { text: "Hi" } }],
          },
        ],
        goal: { url: "https://acme.test/thanks", match: "EXACT" },
        trafficAllocation: 100,
      },
    ],
  };

  it("accepts a v4 document with both kinds", () => {
    expect(isConfigResponse(V4)).toBe(true);
  });

  it("still accepts a v3 document", () => {
    expect(isConfigResponse({ ...VALID, v: 3 })).toBe(true);
  });

  it("rejects an unknown kind or device", () => {
    const [split, ab] = V4.experiments;
    expect(isConfigResponse({ ...V4, experiments: [{ ...split, kind: "multipage" }] })).toBe(false);
    expect(isConfigResponse({ ...V4, experiments: [{ ...ab, devices: ["watch"] }] })).toBe(false);
    expect(isConfigResponse({ ...V4, experiments: [{ ...split, keepParams: "yes" }] })).toBe(false);
  });

  it("rejects a split-URL variant without a URL and a malformed change", () => {
    const [split, ab] = V4.experiments as [Record<string, unknown>, Record<string, unknown>];
    expect(
      isConfigResponse({
        ...V4,
        experiments: [{ ...split, variants: [{ id: "v", weight: 1, url: null }] }],
      }),
    ).toBe(false);
    expect(
      isConfigResponse({
        ...V4,
        experiments: [{ ...ab, variants: [{ id: "v", weight: 1, changes: [{ selector: 1 }] }] }],
      }),
    ).toBe(false);
  });

  it("requests v4 from the server", () => {
    expect(configUrl("https://api.test", "rt_a b")).toBe(
      "https://api.test/api/v1/config?siteId=rt_a%20b&v=4",
    );
  });
});
