import { describe, expect, it } from "vitest";

import { cacheKey, isConfigResponse, readCachedConfig, writeCachedConfig } from "../src/config";
import type { ConfigResponse } from "../src/contract";
import { createMemoryStore } from "../src/env";

const VALID: ConfigResponse = {
  v: 4,
  siteId: "rt_abc",
  ttl: 60,
  experiments: [
    {
      id: "exp_1",
      type: "redirect",
      targeting: {
        match: "EXACT",
        pattern: "https://acme.test/pricing",
        audience: "all",
        devices: ["desktop", "tablet", "mobile"],
        logic: "all",
        conditions: [],
      },
      coverage: 100,
      arms: [
        { position: 0, variantId: null, weight: 50, url: "https://acme.test/pricing" },
        { position: 1, variantId: "var_1", weight: 50, url: "https://acme.test/pricing-v2" },
      ],
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

  it("rejects an experiment with no arms", () => {
    expect(
      isConfigResponse({ ...VALID, experiments: [{ ...VALID.experiments[0], arms: [] }] }),
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
