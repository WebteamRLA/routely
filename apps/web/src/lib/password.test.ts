import { describe, expect, it } from "vitest";

import {
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyAgainstDummy,
  verifyPassword,
} from "@/lib/password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips, and the stored form carries its parameters", async () => {
    const encoded = await hashPassword("Campfire-2026");
    expect(encoded).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword("Campfire-2026", encoded)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const encoded = await hashPassword("Campfire-2026");
    expect(await verifyPassword("Campfire-2025", encoded)).toBe(false);
    expect(await verifyPassword("", encoded)).toBe(false);
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });

  it("treats Unicode-equivalent spellings as the same password", async () => {
    const encoded = await hashPassword("café-latte");
    expect(await verifyPassword("café-latte", encoded)).toBe(true);
  });

  it("verifies hashes made with other (bounded) parameters", async () => {
    // Made with N=16384 — an older, cheaper setting must still verify.
    const { scryptSync } = await import("node:crypto");
    const salt = Buffer.from("0123456789abcdef");
    const key = scryptSync("legacy-pass", salt, 32, { N: 16384, r: 8, p: 1 });
    const encoded = `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
    expect(await verifyPassword("legacy-pass", encoded)).toBe(true);
    expect(needsRehash(encoded)).toBe(true);
  });

  it("never throws on malformed or hostile stored values", async () => {
    for (const bad of [
      "",
      "plain",
      "bcrypt$10$abc",
      "scrypt$x$8$1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
      "scrypt$1000$8$1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA", // not a power of two
      "scrypt$1073741824$8$1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA", // memory bomb
      "scrypt$16384$8$1$$",
    ]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });

  it("current hashes do not need rehashing", async () => {
    expect(needsRehash(await hashPassword("x"))).toBe(false);
    expect(needsRehash("garbage")).toBe(true);
  });

  it("the dummy verification always reports no match", async () => {
    expect(await verifyAgainstDummy("whatever")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("uses the design's copy", () => {
    expect(passwordProblem("pine7")).toBe("Use at least 8 characters.");
    expect(passwordProblem("a".repeat(129))).toBe("Use 128 characters or fewer.");
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("a".repeat(128))).toBeNull();
  });
});
