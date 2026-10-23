import { describe, expect, it } from "vitest";

import {
  EDITOR_TOKEN_TTL_SECONDS,
  type EditorTokenClaims,
  deriveEditorKey,
  pageOrigin,
  signEditorToken,
  verifyEditorToken,
} from "@/lib/editor-token";

const secret = "s".repeat(32);
const now = Date.UTC(2026, 9, 19, 12, 0, 0);
const claims: EditorTokenClaims = {
  experimentId: "cmexp1",
  websiteId: "cmweb1",
  userId: "cmusr1",
  origin: "https://shop.acme.com",
  expiresAt: Math.floor(now / 1000) + EDITOR_TOKEN_TTL_SECONDS,
};

/** The SDK's own shape check (`packages/sdk/src/editor-bridge.ts`). */
const SDK_TOKEN = /^[A-Za-z0-9._~-]{16,1024}$/;

describe("editor tokens", () => {
  it("round-trip their claims, and fit the SDK's token alphabet", () => {
    const token = signEditorToken({ secret, claims });
    expect(token).toMatch(SDK_TOKEN);
    expect(verifyEditorToken({ secret, token, nowMs: now })).toEqual(claims);
  });

  it("are unique per issue", () => {
    expect(signEditorToken({ secret, claims })).not.toBe(signEditorToken({ secret, claims }));
  });

  it("expire", () => {
    const token = signEditorToken({ secret, claims });
    expect(verifyEditorToken({ secret, token, nowMs: claims.expiresAt * 1000 - 1 })).not.toBeNull();
    expect(verifyEditorToken({ secret, token, nowMs: claims.expiresAt * 1000 })).toBeNull();
  });

  it("refuse tampering, another key, and junk", () => {
    const token = signEditorToken({ secret, claims, nonce: "n" });
    const [prefix, payload, signature] = token.split(".") as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString()),
        o: "https://evil.test",
      }),
    ).toString("base64url");

    expect(
      verifyEditorToken({ secret, token: `${prefix}.${forged}.${signature}`, nowMs: now }),
    ).toBeNull();
    expect(verifyEditorToken({ secret: "t".repeat(32), token, nowMs: now })).toBeNull();
    expect(verifyEditorToken({ secret, token: token.slice(0, -2), nowMs: now })).toBeNull();
    expect(verifyEditorToken({ secret, token: `x${token}`, nowMs: now })).toBeNull();
    for (const junk of ["", "rte1", "rte1..", "a.b.c", "rte1.e30.sig"]) {
      expect(verifyEditorToken({ secret, token: junk, nowMs: now })).toBeNull();
    }
  });

  it("pin expected claims", () => {
    const token = signEditorToken({ secret, claims });
    const verify = (expect: Parameters<typeof verifyEditorToken>[0]["expect"]) =>
      verifyEditorToken({ secret, token, nowMs: now, expect });
    expect(verify({ userId: "cmusr1", origin: "https://shop.acme.com" })).not.toBeNull();
    expect(verify({ userId: "cmusr2" })).toBeNull();
    expect(verify({ experimentId: "cmexp2" })).toBeNull();
    expect(verify({ origin: "https://acme.com" })).toBeNull();
  });

  it("refuse claims no session could have", () => {
    expect(() => signEditorToken({ secret, claims: { ...claims, userId: "a b" } })).toThrow();
    expect(() =>
      signEditorToken({ secret, claims: { ...claims, origin: "https://acme.com/path" } }),
    ).toThrow();
    expect(() =>
      signEditorToken({ secret, claims: { ...claims, origin: "javascript:alert(1)" } }),
    ).toThrow();
  });

  it("derive a fallback key that is not AUTH_SECRET itself", () => {
    const auth = "a".repeat(40);
    const key = deriveEditorKey(auth);
    expect(key).toHaveLength(32);
    expect(key.equals(Buffer.from(auth))).toBe(false);
    expect(deriveEditorKey(auth).equals(key)).toBe(true);
    const token = signEditorToken({ secret: key, claims });
    expect(verifyEditorToken({ secret: auth, token, nowMs: now })).toBeNull();
    expect(verifyEditorToken({ secret: key, token, nowMs: now })).toEqual(claims);
  });

  it("take a page's origin from its URL", () => {
    expect(pageOrigin("https://shop.acme.com/p?q=1#x")).toBe("https://shop.acme.com");
    expect(pageOrigin("http://shop.localhost:4001/")).toBe("http://shop.localhost:4001");
    expect(pageOrigin("ftp://acme.com/")).toBeNull();
    expect(pageOrigin("nope")).toBeNull();
  });
});
