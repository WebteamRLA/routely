import {
  type BrowserReport,
  type VerifyOutcome,
  VERIFY_WINDOW_MS,
} from "@/lib/install-verification";

/**
 * The install dialogs' view of a check. Pure, so the hook stays only about timers and windows.
 * What a check concluded is `lib/install-verification.ts`; this only adds what the dashboard alone
 * can know, such as losing touch with the server.
 */

export type VerificationPhase = "idle" | "starting" | "polling";

/** Failed polls in a row before the dialog stops asking. */
export const POLL_MISS_LIMIT = 3;

/**
 * The dialog's own limit. The server's answer goes final at `VERIFY_WINDOW_MS`, so this only fires
 * when that answer can't reach the dialog, for instance a request that never returns.
 */
export const VERIFY_GIVE_UP_MS = VERIFY_WINDOW_MS + 15_000;

/** Shown while the server looks at the page, before the tab has anywhere to go. */
export const STARTING_OUTCOME: VerifyOutcome = {
  status: "waiting",
  final: false,
  title: "Getting your page ready",
  detail: "Your page will open in the new tab in a moment.",
  steps: [],
  warnings: [],
};

/** The check may well have worked; the dialog just can't find out. */
export function lostOutcome(message?: string): VerifyOutcome {
  return {
    status: "failed",
    final: true,
    title: "Verification failed",
    detail: message ?? "We lost contact with Routely before the check finished.",
    steps: ["Check your internet connection, then check again."],
    warnings: [],
  };
}

/** A `routely:verify` message from the opened tab, or null for anything else. */
export function readBrowserMessage(data: unknown): BrowserReport | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, stage, reason } = data as Record<string, unknown>;
  if (type !== "routely:verify") return null;
  if (stage !== "loaded" && stage !== "ready" && stage !== "failed") return null;
  return reason === "config" || reason === "no_site_id" ? { stage, reason } : { stage };
}

export type VerifyTone = "running" | "ok" | "warn" | "fail";

/** Amber when the code is on the page and started; red when it isn't there or isn't right. */
export function verifyTone({ status, final }: VerifyOutcome): VerifyTone {
  if (!final) return "running";
  if (status === "verified") return "ok";
  return status === "sdk_not_initialized" || status === "backend_signal_missing" ? "warn" : "fail";
}

export function verifyButtonLabel(phase: VerificationPhase, outcome: VerifyOutcome | null): string {
  if (phase !== "idle") return "Checking…";
  if (outcome?.status === "verified") return "Verify again";
  return outcome?.final ? "Check again" : "Verify installation";
}
