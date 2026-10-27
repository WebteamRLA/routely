import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETURN_TO,
  readIdTokenClaims,
  sanitizeReturnTo,
  withOutcome,
  signState,
  unverifiedReturnTo,
  verifyState,
} from "@/lib/google-oauth-state";

const SECRET = "test-secret-test-secret-test-secret";
const NOW = 1_800_000_000_000;
const NONCE = "n".repeat(32);

function mint(overrides: Partial<Parameters<typeof signState>[0]> = {}) {
  return signState({
    secret: SECRET,
    nonce: NONCE,
    expiresAt: NOW / 1000 + 600,
    userId: "user_a",
    payload: { workspaceId: "ws_a", returnTo: "/projects/site_1" },
    ...overrides,
  });
}

function verify(state: string, overrides: Partial<Parameters<typeof verifyState>[0]> = {}) {
  return verifyState({
    secret: SECRET,
    state,
    cookieNonce: NONCE,
    userId: "user_a",
    nowMs: NOW,
    ...overrides,
  });
}

describe("OAuth state", () => {
  it("round-trips the workspace and returnTo", () => {
    expect(verify(mint())).toEqual({ workspaceId: "ws_a", returnTo: "/projects/site_1" });
  });

  it("is refused for another user, a wrong cookie, a wrong key or after expiry", () => {
    const state = mint();
    expect(verify(state, { userId: "user_b" })).toBeNull();
    expect(verify(state, { cookieNonce: "m".repeat(32) })).toBeNull();
    expect(verify(state, { cookieNonce: undefined })).toBeNull();
    expect(verify(state, { secret: "another-secret-another-secret-xx" })).toBeNull();
    expect(verify(state, { nowMs: NOW + 601_000 })).toBeNull();
  });

  it("cannot be re-pointed at another workspace or page", () => {
    const [nonce, exp, , sig] = mint().split(".");
    for (const payload of [
      { w: "ws_b", r: "/projects/site_1" },
      { w: "ws_a", r: "/integrations" },
    ]) {
      const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");
      expect(verify(`${nonce}.${exp}.${forged}.${sig}`)).toBeNull();
    }
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "a.b.c", "a.b.c.d.e", `${NONCE}.notanumber.x.y`]) {
      expect(verify(bad)).toBeNull();
    }
  });

  it("never signs a returnTo outside the allow-list", () => {
    const state = mint({ payload: { workspaceId: "ws_a", returnTo: "https://evil.test/x" } });
    expect(verify(state)?.returnTo).toBe(DEFAULT_RETURN_TO);
  });
});

describe("sanitizeReturnTo", () => {
  it("allows only Integrations, a project dashboard, and the Dashboard for a project", () => {
    expect(sanitizeReturnTo("/integrations")).toBe("/integrations");
    expect(sanitizeReturnTo("/projects/cmabc123_-X")).toBe("/projects/cmabc123_-X");
    expect(sanitizeReturnTo("/dashboard?project=cmabc123")).toBe("/dashboard?project=cmabc123");
  });

  it("joins the outcome query whether or not the page has one", () => {
    expect(withOutcome("/projects/p1", "sheets=connected")).toBe("/projects/p1?sheets=connected");
    expect(withOutcome("/dashboard?project=p1", "sheets=connected")).toBe(
      "/dashboard?project=p1&sheets=connected",
    );
  });

  it("falls back for everything else", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "/",
      "//evil.test",
      "/\\evil.test",
      "https://evil.test/projects/x",
      "/projects/",
      "/projects/a/b",
      "/projects/../settings",
      "/projects/x?y=1",
      "/dashboard",
      "/dashboard?project=",
      "/dashboard?project=x&y=1",
      "/dashboard?project=x#y",
      "/dashboard?project=../x",
      "/dashboard?evil=x",
      "/integrations#x",
      "/settings",
      `/projects/${"a".repeat(65)}`,
    ]) {
      expect(sanitizeReturnTo(bad)).toBe(DEFAULT_RETURN_TO);
    }
  });

  it("reads an unverified state's page through the same allow-list", () => {
    const evil = Buffer.from(JSON.stringify({ w: "x", r: "//evil.test" })).toString("base64url");
    expect(unverifiedReturnTo(`a.1.${evil}.sig`)).toBe(DEFAULT_RETURN_TO);
    expect(unverifiedReturnTo(mint())).toBe("/projects/site_1");
    expect(unverifiedReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(unverifiedReturnTo("garbage")).toBe(DEFAULT_RETURN_TO);
  });
});

describe("readIdTokenClaims", () => {
  const token = (claims: object) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("reads email, subject, name and a Google-hosted picture", () => {
    expect(
      readIdTokenClaims(
        token({
          email: "alex@example.com",
          sub: "123",
          name: "Alex Morgan",
          picture: "https://lh3.googleusercontent.com/a/abc=s96-c",
        }),
      ),
    ).toEqual({
      email: "alex@example.com",
      subject: "123",
      name: "Alex Morgan",
      picture: "https://lh3.googleusercontent.com/a/abc=s96-c",
    });
  });

  it("drops a picture that is not https on a Google host", () => {
    for (const picture of [
      "http://lh3.googleusercontent.com/a",
      "https://evil.test/a.png",
      "javascript:alert(1)",
      "https://googleusercontent.com.evil.test/a",
    ]) {
      expect(readIdTokenClaims(token({ picture })).picture).toBeNull();
    }
  });

  it("returns nulls for a missing or unreadable token", () => {
    expect(readIdTokenClaims(undefined).email).toBeNull();
    expect(readIdTokenClaims("not-a-jwt").email).toBeNull();
    expect(readIdTokenClaims("a.!!!.b").email).toBeNull();
  });
});
