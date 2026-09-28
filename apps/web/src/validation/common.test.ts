import { describe, expect, it } from "vitest";

import { idSchema } from "@/validation/common";

/**
 * `idSchema` guards every id that arrives from a client. It has to accept the id formats the
 * database actually holds while still refusing anything shaped like a path or an injection.
 */
describe("idSchema", () => {
  it("accepts the id formats this database contains", () => {
    // cuid, as `@default(cuid())` produces.
    expect(idSchema.safeParse("cmtchy7pt0002h4zz62k1q5hv").success).toBe(true);
    // A UUID. Rejecting these made experiments holding one impossible to save.
    expect(idSchema.safeParse("9266f273-43b6-4e7c-bb59-3a5e4d49a103").success).toBe(true);
    // nanoid, which uses both hyphen and underscore.
    expect(idSchema.safeParse("V1StGXR8_Z5jdHi6B-myT").success).toBe(true);
  });

  it("still refuses anything shaped like a path or an injection", () => {
    for (const bad of [
      "../../etc/passwd",
      "a/b",
      "a\\b",
      "a b",
      "a.b",
      "a'b",
      "a;DROP TABLE experiments",
      "<script>",
      "%2e%2e",
      "",
      "   ",
    ]) {
      expect(
        idSchema.safeParse(bad).success,
        `expected ${JSON.stringify(bad)} to be rejected`,
      ).toBe(false);
    }
  });

  it("bounds the length", () => {
    expect(idSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(idSchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});
