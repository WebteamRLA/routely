import { describe, expect, it } from "vitest";

import {
  CODE_LENGTH,
  derivePendingKey,
  hashVerificationCode,
  newVerificationCode,
  normalizeCode,
  readPending,
  signPending,
} from "@/lib/verify-code";

const KEY = derivePendingKey("test-secret");
const NOW = new Date("2026-10-27T10:00:00Z");
const LATER = new Date("2026-10-28T10:00:00Z");

describe("verification codes", () => {
  it("are six digits, leading zeros included", () => {
    for (let i = 0; i < 200; i++) expect(newVerificationCode()).toMatch(/^\d{6}$/);
    expect(CODE_LENGTH).toBe(6);
  });

  it("accept pasted spaces and dashes, and nothing else", () => {
    expect(normalizeCode(" 012 345 ")).toBe("012345");
    expect(normalizeCode("012-345")).toBe("012345");
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("1234567")).toBeNull();
    expect(normalizeCode("12a456")).toBeNull();
  });

  it("hash per user, so one code is a different hash for two accounts", () => {
    expect(hashVerificationCode("u1", "123456")).not.toBe(hashVerificationCode("u2", "123456"));
    expect(hashVerificationCode("u1", "123456")).toBe(hashVerificationCode("u1", "123456"));
  });
});

describe("the pending cookie", () => {
  it("round-trips the user id until it expires", () => {
    const value = signPending("user_1", LATER, KEY);
    expect(readPending(value, KEY, NOW)).toBe("user_1");
    expect(readPending(value, KEY, LATER)).toBeNull();
  });

  it("refuses a changed user id, a changed expiry, another key and junk", () => {
    const value = signPending("user_1", LATER, KEY);
    const [, exp, sig] = value.split(".");
    expect(readPending(`user_2.${exp}.${sig}`, KEY, NOW)).toBeNull();
    expect(readPending(`user_1.${Number(exp) + 1}.${sig}`, KEY, NOW)).toBeNull();
    expect(readPending(value, derivePendingKey("other"), NOW)).toBeNull();
    expect(readPending(undefined, KEY, NOW)).toBeNull();
    expect(readPending("a.b", KEY, NOW)).toBeNull();
  });
});
