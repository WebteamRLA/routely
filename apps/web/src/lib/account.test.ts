import { describe, expect, it } from "vitest";

import { passwordNote, sessionWhen, sessionWhere, SET_PASSWORD_NOTE } from "@/lib/account";
import {
  changePasswordSchema,
  firstErrors,
  profileSchema,
  resetPasswordSchema,
  signInSchema,
} from "@/validation/account";

const now = new Date("2026-10-19T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("sessionWhen", () => {
  it("follows the design's three shapes", () => {
    expect(sessionWhen(ago(10 * 86_400_000), now, true)).toBe("Active now");
    expect(sessionWhen(ago(60_000), now, false)).toBe("Active now");
    expect(sessionWhen(ago(2 * 3_600_000), now, false)).toBe("2 hours ago");
    expect(sessionWhen(ago(20 * 60_000), now, false)).toBe("20 minutes ago");
    expect(sessionWhen(new Date("2026-10-09T08:00:00Z"), now, false)).toBe("Oct 9, 2026");
  });
});

describe("sessionWhere", () => {
  it("omits what the platform did not supply", () => {
    expect(sessionWhere("Portland", "US")).toBe("Portland, US");
    expect(sessionWhere(null, "US")).toBe("US");
    expect(sessionWhere(null, null)).toBeNull();
  });
});

describe("passwordNote", () => {
  it("states when the password last changed, or offers to set one", () => {
    expect(passwordNote(true, new Date("2026-08-02T10:00:00Z"), now)).toBe(
      "Last changed Aug 2, 2026.",
    );
    expect(passwordNote(true, ago(5_000), now)).toBe("Last changed just now.");
    expect(passwordNote(false, null, now)).toBe(SET_PASSWORD_NOTE);
  });
});

describe("account validation copy", () => {
  it("profile: the design's messages", () => {
    expect(firstErrors(profileSchema, { name: "", email: "alex@fernwood" })).toEqual({
      name: "Enter your name.",
      email: "Enter a valid email address, like name@company.com.",
    });
    expect(firstErrors(profileSchema, { name: "x".repeat(81), email: "" })).toEqual({
      name: "Use 80 characters or fewer.",
      email: "Enter your email address.",
    });
    expect(firstErrors(profileSchema, { name: "Alex", email: "Alex@Example.com" })).toEqual({});
  });

  it("change password: matches the design's passwordErrors view", () => {
    expect(
      firstErrors(changePasswordSchema, {
        current: "TrailMix24",
        next: "pine7",
        confirm: "pine77",
        hasPassword: true,
      }),
    ).toEqual({ next: "Use at least 8 characters.", confirm: "Passwords don’t match." });
    expect(
      firstErrors(changePasswordSchema, { current: "", next: "", confirm: "", hasPassword: true }),
    ).toEqual({
      current: "Enter your current password.",
      next: "Enter a new password.",
      confirm: "Enter the new password again.",
    });
    expect(
      firstErrors(changePasswordSchema, {
        current: "Same-pass-1",
        next: "Same-pass-1",
        confirm: "Same-pass-1",
        hasPassword: true,
      }),
    ).toEqual({ next: "Choose a password that’s different from your current one." });
  });

  it("set password (Google-only) needs no current password", () => {
    expect(
      firstErrors(changePasswordSchema, {
        current: "",
        next: "Campfire-2026",
        confirm: "Campfire-2026",
        hasPassword: false,
      }),
    ).toEqual({});
  });

  it("reset and sign-in", () => {
    expect(firstErrors(resetPasswordSchema, { password: "short", confirm: "x" })).toEqual({
      password: "Use at least 8 characters.",
      confirm: "Passwords don’t match.",
    });
    expect(firstErrors(signInSchema, { email: "", password: "" })).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
  });
});
