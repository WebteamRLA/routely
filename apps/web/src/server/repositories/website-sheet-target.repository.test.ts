import { describe, expect, it, vi } from "vitest";

import type { DbClient } from "@/server/db";
import { claimErrorNotification } from "@/server/repositories/website-sheet-target.repository";

// The real client reads DATABASE_URL at import; every call below passes its own client instead.
vi.mock("@/server/db", () => ({ db: {} }));

/**
 * The SHEETS_SYNC_FAILED latch, against an in-memory stand-in that applies `updateMany`'s `where`
 * atomically — which is what Postgres does for a single UPDATE. Proves the claim is a
 * compare-and-set (the condition is *in* the write), not a read-then-write.
 */
function fakeClient(row: { id: string; lastError: string | null; errorNotifiedAt: Date | null }) {
  const calls: unknown[] = [];
  const client = {
    websiteSheetTarget: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; errorNotifiedAt: null; lastError: { not: null } };
        data: { errorNotifiedAt: Date };
      }) => {
        calls.push(where);
        await Promise.resolve();
        const matches =
          where.id === row.id &&
          row.errorNotifiedAt === where.errorNotifiedAt &&
          row.lastError !== null;
        if (matches) row.errorNotifiedAt = data.errorNotifiedAt;
        return { count: matches ? 1 : 0 };
      },
    },
  } as unknown as DbClient;
  return { client, calls, row };
}

describe("claimErrorNotification", () => {
  it("lets exactly one of many concurrent failures announce", async () => {
    const { client, row } = fakeClient({ id: "t1", lastError: "boom", errorNotifiedAt: null });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimErrorNotification("t1", new Date(), client)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(row.errorNotifiedAt).toBeInstanceOf(Date);
  });

  it("puts the condition in the write itself", async () => {
    const { client, calls } = fakeClient({ id: "t1", lastError: "boom", errorNotifiedAt: null });
    await claimErrorNotification("t1", new Date(), client);
    expect(calls[0]).toEqual({ id: "t1", errorNotifiedAt: null, lastError: { not: null } });
  });

  it("does not announce once latched, or when the error has already cleared", async () => {
    const latched = fakeClient({ id: "t1", lastError: "boom", errorNotifiedAt: new Date(0) });
    expect(await claimErrorNotification("t1", new Date(), latched.client)).toBe(false);

    const recovered = fakeClient({ id: "t1", lastError: null, errorNotifiedAt: null });
    expect(await claimErrorNotification("t1", new Date(), recovered.client)).toBe(false);
  });
});
