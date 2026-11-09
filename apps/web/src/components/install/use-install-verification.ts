"use client";

import { useEffect, useRef, useState } from "react";

import type { InstallMethodName, VerifyOutcome } from "@/lib/install-verification";
import { checkInstallAction } from "@/server/actions/install.actions";

import type { VerificationPhase } from "./verification-state";

/**
 * Runs an install check from the dashboard's side: one request, answered from the server's look at
 * the page and any published Google Tag Manager container. Nothing opens in the browser.
 */

export interface VerificationInput {
  websiteId: string;
  url: string;
  method: InstallMethodName;
}

export interface InstallVerification {
  phase: VerificationPhase;
  /** The latest check's answer. A refused check leaves the previous answer in place. */
  outcome: VerifyOutcome | null;
  /** The server refused to run the check, so nothing was checked. */
  error: string;
  start(input: VerificationInput): void;
  reset(): void;
  clearError(): void;
}

export function useInstallVerification({
  onVerified,
  onCheckingChange,
}: {
  onVerified(): void;
  onCheckingChange?(checking: boolean): void;
}): InstallVerification {
  const [phase, setPhase] = useState<VerificationPhase>("idle");
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [error, setError] = useState("");

  const callbacks = useRef({ onVerified, onCheckingChange });
  useEffect(() => {
    callbacks.current = { onVerified, onCheckingChange };
  });

  /** The current check. Moving it on discards a late answer, e.g. after the dialog closed. */
  const runRef = useRef(0);
  useEffect(
    () => () => {
      runRef.current += 1;
      callbacks.current.onCheckingChange?.(false);
    },
    [],
  );

  async function run(id: number, input: VerificationInput) {
    const res = await checkInstallAction(input).catch(() => null);
    if (id !== runRef.current) return;

    setPhase("idle");
    callbacks.current.onCheckingChange?.(false);
    if (!res?.ok) {
      setError(res?.fieldErrors?.url ?? res?.message ?? "We couldn’t check that page. Try again.");
      return;
    }
    setOutcome(res.data);
    if (res.data.status === "verified") callbacks.current.onVerified();
  }

  function start(input: VerificationInput) {
    if (phase !== "idle") return;
    runRef.current += 1;
    setError("");
    setPhase("checking");
    callbacks.current.onCheckingChange?.(true);
    void run(runRef.current, input);
  }

  function reset() {
    setOutcome(null);
    setError("");
  }

  return { phase, outcome, error, start, reset, clearError: () => setError("") };
}
