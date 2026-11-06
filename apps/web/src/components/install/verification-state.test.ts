import { describe, expect, it } from "vitest";

import { type InstallStatus, type VerifyOutcome } from "@/lib/install-verification";

import {
  lostOutcome,
  readBrowserMessage,
  verifyButtonLabel,
  verifyTone,
} from "./verification-state";

const outcome = (status: InstallStatus, final = true): VerifyOutcome => ({
  status,
  final,
  title: "t",
  detail: "d",
  steps: [],
  warnings: [],
});

describe("readBrowserMessage", () => {
  it("keeps the stage and a known reason", () => {
    expect(
      readBrowserMessage({ type: "routely:verify", stage: "failed", reason: "config" }),
    ).toEqual({ stage: "failed", reason: "config" });
  });

  it("drops what the poll schema would refuse, rather than failing the poll", () => {
    expect(
      readBrowserMessage({
        type: "routely:verify",
        stage: "ready",
        reason: "other",
        siteIds: ["rt_x"],
      }),
    ).toEqual({ stage: "ready" });
  });

  it("ignores anything else a page might post", () => {
    expect(readBrowserMessage({ type: "routely:hello", stage: "ready" })).toBeNull();
    expect(readBrowserMessage({ type: "routely:verify", stage: "done" })).toBeNull();
    expect(readBrowserMessage("routely:verify")).toBeNull();
    expect(readBrowserMessage(null)).toBeNull();
  });
});

describe("verifyTone", () => {
  it("reads a check still running as running, whatever its status", () => {
    expect(verifyTone(outcome("waiting", false))).toBe("running");
    expect(verifyTone(outcome("in_progress", false))).toBe("running");
  });

  it("is green only for a verified install", () => {
    expect(verifyTone(outcome("verified"))).toBe("ok");
  });

  it("is amber when the code started, red when it isn't there or isn't right", () => {
    expect(verifyTone(outcome("sdk_not_initialized"))).toBe("warn");
    expect(verifyTone(outcome("backend_signal_missing"))).toBe("warn");
    expect(verifyTone(outcome("not_installed"))).toBe("fail");
    expect(verifyTone(outcome("wrong_site_id"))).toBe("fail");
    expect(verifyTone(outcome("sdk_failed_to_load"))).toBe("fail");
    expect(verifyTone(outcome("failed"))).toBe("fail");
  });
});

describe("verifyButtonLabel", () => {
  it("offers a new run after any final failure", () => {
    expect(verifyButtonLabel("idle", outcome("not_installed"))).toBe("Check again");
    expect(verifyButtonLabel("idle", lostOutcome())).toBe("Check again");
  });

  it("covers the other states", () => {
    expect(verifyButtonLabel("idle", null)).toBe("Verify installation");
    expect(verifyButtonLabel("idle", outcome("verified"))).toBe("Verify again");
    expect(verifyButtonLabel("starting", outcome("not_installed"))).toBe("Checking…");
    expect(verifyButtonLabel("polling", outcome("waiting", false))).toBe("Checking…");
  });
});

describe("lostOutcome", () => {
  it("is final, so the dialog stops", () => {
    expect(lostOutcome().final).toBe(true);
  });

  it("prefers the server's reason", () => {
    expect(lostOutcome("That check has expired. Start it again.").detail).toBe(
      "That check has expired. Start it again.",
    );
  });
});
