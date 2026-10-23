import { describe, expect, it } from "vitest";

import {
  type SheetsAccount,
  initialsFor,
  outcomeQuery,
  readSheetsOutcome,
  sheetsStatus,
  spreadsheetUrl,
} from "@/lib/sheets-card";

const account: SheetsAccount = {
  email: "alex@example.com",
  name: null,
  picture: null,
  initials: "AL",
  status: "CONNECTED",
  statusDetail: null,
  canUseSheets: true,
  isConnector: true,
};

describe("readSheetsOutcome", () => {
  it("reads the callback's codes", () => {
    expect(readSheetsOutcome({ sheets: "connected" })).toEqual({ kind: "connected" });
    expect(readSheetsOutcome({ sheets: "error", reason: "denied" })).toMatchObject({
      kind: "error",
      reason: "denied",
      message: "Google sign-in didn’t finish. Try again.",
    });
    expect(readSheetsOutcome({ sheets: "error", reason: "scope" })).toMatchObject({
      reason: "scope",
    });
  });

  it("never shows text from the URL", () => {
    const outcome = readSheetsOutcome({
      sheets: "error",
      reason: "Your account is suspended, call +1 555",
      detail: "Your account is suspended",
    });
    expect(outcome).toMatchObject({ reason: "connect" });
    expect(JSON.stringify(outcome)).not.toContain("suspended");
  });

  it("is null without an outcome", () => {
    expect(readSheetsOutcome(undefined)).toBeNull();
    expect(readSheetsOutcome({ sheets: "whatever" })).toBeNull();
  });

  it("matches what the callback writes", () => {
    const parse = (q: string) => Object.fromEntries(new URLSearchParams(q));
    expect(readSheetsOutcome(parse(outcomeQuery("connected")))).toEqual({ kind: "connected" });
    expect(readSheetsOutcome(parse(outcomeQuery("refresh")))).toMatchObject({ reason: "refresh" });
  });
});

describe("sheetsStatus", () => {
  it("orders the states by urgency", () => {
    expect(sheetsStatus({ configured: false, account, failing: true })).toBe("not_configured");
    expect(sheetsStatus({ configured: true, account: null, failing: false })).toBe("none");
    expect(
      sheetsStatus({
        configured: true,
        account: { ...account, status: "NEEDS_RECONNECT" },
        failing: false,
      }),
    ).toBe("needs_reconnect");
    expect(
      sheetsStatus({
        configured: true,
        account: { ...account, canUseSheets: false },
        failing: false,
      }),
    ).toBe("needs_reconnect");
    expect(sheetsStatus({ configured: true, account, failing: true })).toBe("sync_stopped");
    expect(sheetsStatus({ configured: true, account, failing: false })).toBe("connected");
  });
});

describe("helpers", () => {
  it("builds the Open in Google Sheets link", () => {
    expect(spreadsheetUrl("abc_DEF-123", 42)).toBe(
      "https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=42",
    );
  });

  it("derives avatar initials", () => {
    expect(initialsFor("Alex Morgan", "x@y.z")).toBe("AM");
    expect(initialsFor("Cher", null)).toBe("CH");
    expect(initialsFor(null, "alex.morgan@example.com")).toBe("AL");
    expect(initialsFor(null, null)).toBe("G");
  });
});
