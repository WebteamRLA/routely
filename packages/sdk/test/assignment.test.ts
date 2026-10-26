import { describe, expect, it, vi } from "vitest";

import {
  assignmentKey,
  knownAssignment,
  obtainAssignment,
  readAssignment,
  requestAssignment,
  writeAssignment,
} from "../src/assignment";
import type { AssignResponse } from "../src/contract";
import { createMemoryStore } from "../src/env";

/**
 * The browser side of assignment: the arm is the server's (`POST /api/v1/assign`, balanced there —
 * see `apps/web/src/lib/balance.test.ts`), asked for once and then read from storage. These tests
 * pin the "once": repeat visits and refreshes never ask again, and nothing is ever guessed.
 */

const EXP = "exp_1";
const VARIANT_ID = "var_1";

/** A server that answers `variantId` and counts how often it was asked. */
function server(answer: AssignResponse | null) {
  return vi.fn(async () => answer);
}

describe("obtainAssignment", () => {
  it("asks the server once, stores the answer as already recorded, and returns it", async () => {
    const stores = [createMemoryStore()];
    const ask = server({ variantId: VARIANT_ID });

    expect(await obtainAssignment(EXP, stores, ask)).toBe(VARIANT_ID);
    expect(ask).toHaveBeenCalledTimes(1);
    // `sent`: the server wrote the assignment when it chose it, so no assignment event follows.
    expect(readAssignment(EXP, stores)).toMatchObject({ variantId: VARIANT_ID, sent: true });
  });

  it("keeps a control answer as control (null), not as 'no answer'", async () => {
    const stores = [createMemoryStore()];
    expect(await obtainAssignment(EXP, stores, server({ variantId: null }))).toBeNull();
    expect(readAssignment(EXP, stores)?.variantId).toBeNull();
  });

  it("never asks again on a repeat visit: the returning visitor keeps their version", async () => {
    const stores = [createMemoryStore()];
    await obtainAssignment(EXP, stores, server({ variantId: VARIANT_ID }));

    // The server would now say something else — it is never asked.
    const later = server({ variantId: null });
    for (let visit = 0; visit < 20; visit += 1) {
      expect(await obtainAssignment(EXP, stores, later)).toBe(VARIANT_ID);
    }
    expect(later).not.toHaveBeenCalled();
  });

  it("does not ask on a refresh, which reads the same storage again", async () => {
    const storage = createMemoryStore();
    await obtainAssignment(EXP, [storage], server({ variantId: VARIANT_ID }));

    const ask = server({ variantId: null });
    for (let refresh = 0; refresh < 5; refresh += 1) {
      // A refresh: a new page load, new store list, the same underlying storage.
      expect(await obtainAssignment(EXP, [storage, createMemoryStore()], ask)).toBe(VARIANT_ID);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not enter the visitor — and guesses nothing — when the server cannot answer", async () => {
    const stores = [createMemoryStore()];
    expect(await obtainAssignment(EXP, stores, server(null))).toBeUndefined();
    expect(readAssignment(EXP, stores)).toBeNull();

    // The next page load asks again.
    expect(await obtainAssignment(EXP, stores, server({ variantId: VARIANT_ID }))).toBe(VARIANT_ID);
  });

  it("rejects a malformed answer rather than storing it", async () => {
    const stores = [createMemoryStore()];
    const junk = vi.fn(async () => ({ variantId: 42 }) as unknown as AssignResponse);
    expect(await obtainAssignment(EXP, stores, junk)).toBeUndefined();
    expect(readAssignment(EXP, stores)).toBeNull();
  });

  it("keeps separate experiments independent", async () => {
    const stores = [createMemoryStore()];
    await obtainAssignment("exp_1", stores, server({ variantId: VARIANT_ID }));
    await obtainAssignment("exp_2", stores, server({ variantId: null }));

    expect(readAssignment("exp_1", stores)?.variantId).toBe(VARIANT_ID);
    expect(readAssignment("exp_2", stores)?.variantId).toBeNull();
    expect(assignmentKey("exp_1")).not.toBe(assignmentKey("exp_2"));
  });

  it("asks again when the stored value is corrupted or the wrong type", async () => {
    const corrupt = createMemoryStore();
    corrupt.setItem(assignmentKey(EXP), "{not json");
    expect(await obtainAssignment(EXP, [corrupt], server({ variantId: VARIANT_ID }))).toBe(
      VARIANT_ID,
    );

    const wrongType = createMemoryStore();
    wrongType.setItem(assignmentKey(EXP), JSON.stringify({ variantId: 12345 }));
    expect(await obtainAssignment(EXP, [wrongType], server({ variantId: null }))).toBeNull();
  });

  it("writes to every store so one being cleared does not re-ask", async () => {
    const local = createMemoryStore();
    const memory = createMemoryStore();
    await obtainAssignment(EXP, [local, memory], server({ variantId: VARIANT_ID }));

    local.removeItem(assignmentKey(EXP));

    const ask = server({ variantId: null });
    expect(await obtainAssignment(EXP, [local, memory], ask)).toBe(VARIANT_ID);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("knownAssignment", () => {
  it("applies a handed-over decision only when nothing is stored", () => {
    const fresh = [createMemoryStore()];
    expect(knownAssignment(EXP, fresh, VARIANT_ID)).toBe(VARIANT_ID);
    expect(readAssignment(EXP, fresh)?.variantId).toBe(VARIANT_ID);

    // An existing assignment must not be overwritten by a value from a query string.
    const existing = [createMemoryStore()];
    writeAssignment(EXP, { variantId: null, at: 0, sent: true }, existing);
    expect(knownAssignment(EXP, existing, VARIANT_ID)).toBeNull();
  });

  it("distinguishes forced to control (null) from no forced value (undefined)", () => {
    expect(knownAssignment(EXP, [createMemoryStore()], null)).toBeNull();
    expect(knownAssignment(EXP, [createMemoryStore()])).toBeUndefined();
  });

  it("marks a handed-over decision as not yet reported, so its assignment event is sent", () => {
    const stores = [createMemoryStore()];
    knownAssignment(EXP, stores, VARIANT_ID);
    expect(readAssignment(EXP, stores)?.sent).toBe(false);
  });
});

describe("requestAssignment", () => {
  it("posts the visitor and experiment as text/plain, naming no arm", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ variantId: "v" }) }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const answer = await requestAssignment("https://api.test", {
        siteId: "rt_abc",
        visitorId: "visitor-1",
        experimentId: EXP,
      });
      expect(answer).toEqual({ variantId: "v" });

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.test/api/v1/assign");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("omit");
      expect(typeof init.body).toBe("string"); // a string body is sent as text/plain: no preflight
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({ v: 4, siteId: "rt_abc", visitorId: "visitor-1", experimentId: EXP });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves null — not entered — on a 204, an error status or a network failure", async () => {
    const answers = [
      async () => ({ ok: true, json: async () => JSON.parse("") as unknown }),
      async () => ({ ok: false, json: async () => ({}) }),
      async () => {
        throw new Error("offline");
      },
    ];
    for (const answer of answers) {
      vi.stubGlobal("fetch", vi.fn(answer));
      try {
        expect(
          await requestAssignment("https://api.test", {
            siteId: "rt_abc",
            visitorId: "visitor-1",
            experimentId: EXP,
          }),
        ).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});
