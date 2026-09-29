import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SECRET_PURPOSES, decryptWithKey, encryptWithKey, secretsMatch } from "@/lib/secret-box";

/**
 * Only the key-taking functions are tested: they are pure, so every property that matters can be
 * asserted without an environment. `encryptSecret`/`decryptSecret` are the same code with the key
 * read from `env`.
 *
 * What is being protected here is a Google refresh token — a credential for somebody else's
 * Drive. So these tests are less about "does it round-trip" and more about "does it refuse
 * everything it should refuse".
 */
const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const TOKEN = "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-not_a_real_refresh_token";

describe("encryptWithKey / decryptWithKey", () => {
  it("round-trips a value", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);

    expect(decryptWithKey(KEY, sealed, SECRET_PURPOSES.googleRefreshToken)).toBe(TOKEN);
  });

  it("does not leave the plaintext anywhere in the output", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);

    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain("refresh_token");
  });

  it("emits a versioned, four-part format", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);
    const parts = sealed.split(".");

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    // 12-byte IV and 16-byte tag, base64url — unpadded, so 16 and 22 characters.
    expect(Buffer.from(parts[1] as string, "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2] as string, "base64url")).toHaveLength(16);
  });

  it("uses a fresh IV per call, so the same plaintext never encrypts identically", () => {
    // IV reuse is the one catastrophic misuse of GCM. If this ever fails, the scheme is broken,
    // not merely inelegant.
    const first = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);
    const second = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);

    expect(first).not.toBe(second);
    expect(first.split(".")[1]).not.toBe(second.split(".")[1]);
    expect(decryptWithKey(KEY, second, SECRET_PURPOSES.googleRefreshToken)).toBe(TOKEN);
  });

  it("round-trips an empty string and multi-byte text", () => {
    for (const plaintext of ["", "ünïcødé — ✓", "🔐".repeat(50)]) {
      const sealed = encryptWithKey(KEY, plaintext, SECRET_PURPOSES.googleAccessToken);
      expect(decryptWithKey(KEY, sealed, SECRET_PURPOSES.googleAccessToken)).toBe(plaintext);
    }
  });

  it("refuses a tampered ciphertext", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);
    const parts = sealed.split(".");
    const ciphertext = Buffer.from(parts[3] as string, "base64url");

    // Flip one bit. Under an unauthenticated mode this would decrypt to a corrupted token that
    // gets sent to Google; under GCM it must fail.
    ciphertext[0] = (ciphertext[0] as number) ^ 0x01;
    const forged = [parts[0], parts[1], parts[2], ciphertext.toString("base64url")].join(".");

    expect(() => decryptWithKey(KEY, forged, SECRET_PURPOSES.googleRefreshToken)).toThrow();
  });

  it("refuses a tampered authentication tag", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);
    const parts = sealed.split(".");
    const tag = Buffer.from(parts[2] as string, "base64url");

    tag[0] = (tag[0] as number) ^ 0x01;
    const forged = [parts[0], parts[1], tag.toString("base64url"), parts[3]].join(".");

    expect(() => decryptWithKey(KEY, forged, SECRET_PURPOSES.googleRefreshToken)).toThrow();
  });

  it("refuses the wrong key", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);

    expect(() => decryptWithKey(OTHER_KEY, sealed, SECRET_PURPOSES.googleRefreshToken)).toThrow();
  });

  it("refuses a value encrypted for a different purpose", () => {
    /*
     * This is what stops a ciphertext being lifted out of one column and pasted into another.
     * A refresh token moved into the access-token column must fail to decrypt rather than
     * becoming a working token with the wrong lifetime.
     */
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);

    expect(() => decryptWithKey(KEY, sealed, SECRET_PURPOSES.googleAccessToken)).toThrow();
  });

  it("refuses an unknown scheme version", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);
    const forged = sealed.replace(/^v1\./, "v2.");

    expect(() => decryptWithKey(KEY, forged, SECRET_PURPOSES.googleRefreshToken)).toThrow(
      /Unsupported encryption scheme/,
    );
  });

  it("refuses a malformed value", () => {
    for (const bad of ["", "v1", "v1.a.b", "v1.a.b.c.d", "not-encrypted-at-all"]) {
      expect(
        () => decryptWithKey(KEY, bad, SECRET_PURPOSES.googleRefreshToken),
        `expected ${JSON.stringify(bad)} to be rejected`,
      ).toThrow();
    }
  });

  it("refuses an IV or tag of the wrong length", () => {
    const sealed = encryptWithKey(KEY, TOKEN, SECRET_PURPOSES.googleRefreshToken);
    const parts = sealed.split(".");

    const shortIv = [parts[0], randomBytes(8).toString("base64url"), parts[2], parts[3]].join(".");
    expect(() => decryptWithKey(KEY, shortIv, SECRET_PURPOSES.googleRefreshToken)).toThrow(
      /IV must be 12 bytes/,
    );

    const shortTag = [parts[0], parts[1], randomBytes(8).toString("base64url"), parts[3]].join(".");
    expect(() => decryptWithKey(KEY, shortTag, SECRET_PURPOSES.googleRefreshToken)).toThrow(
      /auth tag must be 16 bytes/,
    );
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() =>
      encryptWithKey(randomBytes(16), TOKEN, SECRET_PURPOSES.googleRefreshToken),
    ).toThrow(/must be 32 bytes/);
  });
});

describe("secretsMatch", () => {
  it("matches identical secrets and rejects everything else", () => {
    expect(secretsMatch("Bearer abc123", "Bearer abc123")).toBe(true);
    expect(secretsMatch("Bearer abc123", "Bearer abc124")).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });

  it("compares secrets of different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the hashing step is what makes this safe
    // to call with attacker-controlled input of any length.
    expect(secretsMatch("short", "a much longer value than the other one")).toBe(false);
    expect(secretsMatch("a".repeat(10_000), "b")).toBe(false);
  });
});
