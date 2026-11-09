import { describe, expect, it } from "vitest";

import { type InstallStatus, type VerifyOutcome } from "@/lib/install-verification";

import { verifyButtonLabel, verifyTone } from "./verification-state";

const outcome = (status: InstallStatus, final = true): VerifyOutcome => ({
  status,
  final,
  title: "t",
  detail: "d",
  steps: [],
  warnings: [],
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
    expect(verifyTone(outcome("anti_flicker"))).toBe("warn");
    expect(verifyTone(outcome("not_installed"))).toBe("fail");
    expect(verifyTone(outcome("wrong_site_id"))).toBe("fail");
    expect(verifyTone(outcome("sdk_failed_to_load"))).toBe("fail");
    expect(verifyTone(outcome("failed"))).toBe("fail");
  });
});

describe("verifyButtonLabel", () => {
  it("offers a new run after any final failure", () => {
    expect(verifyButtonLabel("idle", outcome("not_installed"))).toBe("Check again");
    expect(verifyButtonLabel("idle", outcome("failed"))).toBe("Check again");
  });

  it("covers the other states", () => {
    expect(verifyButtonLabel("idle", null)).toBe("Verify installation");
    expect(verifyButtonLabel("idle", outcome("verified"))).toBe("Verify again");
    expect(verifyButtonLabel("checking", outcome("not_installed"))).toBe("Checking…");
  });
});
