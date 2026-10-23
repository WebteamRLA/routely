import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_SETTINGS,
  type RecipientCandidate,
  isRoleAtLeast,
  resolveRecipients,
} from "@/lib/notifications";

const VERIFIED = new Date("2026-01-01T00:00:00Z");

function member(overrides: Partial<RecipientCandidate> & { userId: string }): RecipientCandidate {
  return {
    email: `${overrides.userId}@acme.test`,
    name: overrides.userId,
    role: "EDITOR",
    emailVerified: VERIFIED,
    disabledAt: null,
    preference: null,
    ...overrides,
  };
}

const ids = (list: RecipientCandidate[]) => list.map((candidate) => candidate.userId);

describe("defaults (spec §5.5)", () => {
  it("has a setting for every kind", () => {
    expect(Object.keys(NOTIFICATION_SETTINGS).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it("is on for everything except EXPERIMENT_PAUSED", () => {
    expect(NOTIFICATION_SETTINGS.RESULT_READY.defaultEnabled).toBe(true);
    expect(NOTIFICATION_SETTINGS.TRACKING_STOPPED.defaultEnabled).toBe(true);
    expect(NOTIFICATION_SETTINGS.SHEETS_SYNC_FAILED.defaultEnabled).toBe(true);
    expect(NOTIFICATION_SETTINGS.EXPERIMENT_PAUSED.defaultEnabled).toBe(false);
  });
});

describe("isRoleAtLeast", () => {
  it("orders OWNER > ADMIN > EDITOR > VIEWER", () => {
    expect(isRoleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(isRoleAtLeast("ADMIN", "ADMIN")).toBe(true);
    expect(isRoleAtLeast("EDITOR", "ADMIN")).toBe(false);
    expect(isRoleAtLeast("VIEWER", "VIEWER")).toBe(true);
  });
});

describe("resolveRecipients", () => {
  it("applies the default when there is no stored preference", () => {
    const team = [member({ userId: "a" }), member({ userId: "b" })];
    expect(ids(resolveRecipients("RESULT_READY", team))).toEqual(["a", "b"]);
    expect(ids(resolveRecipients("EXPERIMENT_PAUSED", team))).toEqual([]);
  });

  it("lets a stored row override the default either way", () => {
    const team = [
      member({ userId: "off", preference: false }),
      member({ userId: "on", preference: true }),
      member({ userId: "default" }),
    ];
    expect(ids(resolveRecipients("RESULT_READY", team))).toEqual(["on", "default"]);
    expect(ids(resolveRecipients("EXPERIMENT_PAUSED", team))).toEqual(["on"]);
  });

  it("excludes the actor", () => {
    const team = [
      member({ userId: "actor", preference: true }),
      member({ userId: "other", preference: true }),
    ];
    expect(ids(resolveRecipients("EXPERIMENT_PAUSED", team, { excludeUserId: "actor" }))).toEqual([
      "other",
    ]);
  });

  it("sends Sheets failures only to Owners and Admins", () => {
    const team = [
      member({ userId: "o", role: "OWNER" }),
      member({ userId: "a", role: "ADMIN" }),
      member({ userId: "e", role: "EDITOR", preference: true }),
      member({ userId: "v", role: "VIEWER" }),
    ];
    expect(ids(resolveRecipients("SHEETS_SYNC_FAILED", team))).toEqual(["o", "a"]);
  });

  it("lets minRole tighten the floor but never loosen it", () => {
    const team = [
      member({ userId: "o", role: "OWNER" }),
      member({ userId: "a", role: "ADMIN" }),
      member({ userId: "v", role: "VIEWER" }),
    ];
    expect(ids(resolveRecipients("RESULT_READY", team, { minRole: "ADMIN" }))).toEqual(["o", "a"]);
    expect(ids(resolveRecipients("SHEETS_SYNC_FAILED", team, { minRole: "VIEWER" }))).toEqual([
      "o",
      "a",
    ]);
  });

  it("skips disabled accounts and unverified addresses", () => {
    const team = [
      member({ userId: "ok" }),
      member({ userId: "disabled", disabledAt: VERIFIED }),
      member({ userId: "unverified", emailVerified: null }),
    ];
    expect(ids(resolveRecipients("TRACKING_STOPPED", team))).toEqual(["ok"]);
  });

  it("sends one email per address", () => {
    const team = [
      member({ userId: "a", email: "Sam@Acme.test" }),
      member({ userId: "b", email: "sam@acme.test " }),
    ];
    expect(ids(resolveRecipients("RESULT_READY", team))).toEqual(["a"]);
  });
});
