import { describe, expect, it } from "vitest";

import { eventBatchSchema } from "@/validation/tracking";

const base = { siteId: "rt_" + "a".repeat(32), visitorId: "visitor-123" };
const exp = { experimentId: "exp_1", variantId: null, url: "https://acme.test/p", ts: 1_000 };

describe("event batches", () => {
  it("accepts v4 site events alongside experiment events", () => {
    const parsed = eventBatchSchema.safeParse({
      v: 4,
      ...base,
      events: [
        { ...exp, type: "assignment" },
        { ...exp, type: "page_view" },
        { type: "page", url: "https://acme.test/p", ts: 1_000 },
        { type: "track", key: "signup", url: "https://acme.test/p", ts: 1_000 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a conversion from a v4 bundle — the server derives those", () => {
    expect(
      eventBatchSchema.safeParse({ v: 4, ...base, events: [{ ...exp, type: "conversion" }] })
        .success,
    ).toBe(false);
  });

  it("still accepts a v3 bundle's conversion, and refuses site events from it", () => {
    expect(
      eventBatchSchema.safeParse({ v: 3, ...base, events: [{ ...exp, type: "conversion" }] })
        .success,
    ).toBe(true);
    expect(
      eventBatchSchema.safeParse({
        v: 3,
        ...base,
        events: [{ type: "page", url: "https://acme.test/p", ts: 1 }],
      }).success,
    ).toBe(false);
  });

  it("refuses malformed keys and unknown versions", () => {
    expect(
      eventBatchSchema.safeParse({
        v: 4,
        ...base,
        events: [{ type: "track", key: "has space", url: "https://acme.test/p", ts: 1 }],
      }).success,
    ).toBe(false);
    expect(
      eventBatchSchema.safeParse({ v: 2, ...base, events: [{ ...exp, type: "page_view" }] })
        .success,
    ).toBe(false);
  });
});
