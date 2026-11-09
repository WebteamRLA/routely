import type { VerifyOutcome } from "@/lib/install-verification";

/**
 * The install dialogs' view of a check. Pure. What a check concluded is
 * `lib/install-verification.ts`; this only adds what the dialog shows around it.
 */

export type VerificationPhase = "idle" | "checking";

/** Shown while the server reads the page. */
export const CHECKING_OUTCOME: VerifyOutcome = {
  status: "in_progress",
  final: false,
  title: "Checking your page",
  detail: "Routely is reading the page and any Google Tag Manager container it loads.",
  steps: [],
  warnings: [],
};

export type VerifyTone = "running" | "ok" | "warn" | "fail";

/** Amber when the code is in place but something beside it is wrong (it didn't start, or the
 * anti-flicker block is missing or misplaced); red when the code isn't there or isn't right. */
export function verifyTone({ status, final }: VerifyOutcome): VerifyTone {
  if (!final) return "running";
  if (status === "verified") return "ok";
  return status === "sdk_not_initialized" ||
    status === "backend_signal_missing" ||
    status === "anti_flicker"
    ? "warn"
    : "fail";
}

export function verifyButtonLabel(phase: VerificationPhase, outcome: VerifyOutcome | null): string {
  if (phase !== "idle") return "Checking…";
  if (outcome?.status === "verified") return "Verify again";
  return outcome?.final ? "Check again" : "Verify installation";
}
