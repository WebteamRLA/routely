"use client";

import { useEffect, useRef, useState } from "react";

import {
  type BrowserReport,
  type InstallMethodName,
  type VerifyOutcome,
  VERIFY_POLL_MS,
} from "@/lib/install-verification";
import { pollVerificationAction, startVerificationAction } from "@/server/actions/install.actions";

import {
  POLL_MISS_LIMIT,
  VERIFY_GIVE_UP_MS,
  type VerificationPhase,
  lostOutcome,
  readBrowserMessage,
} from "./verification-state";

/**
 * Runs an install check from the dashboard's side: open the customer's page in a real tab, then
 * ask the server what the SDK there reported.
 *
 * The tab is opened without `noopener`, because the SDK answers on `window.opener`. Its `closed`
 * flag decides nothing: a page sending `Cross-Origin-Opener-Policy` severs the link and reads as
 * closed while the check is working normally, so only the server's answer ends a run.
 */

export interface VerificationInput {
  websiteId: string;
  url: string;
  method: InstallMethodName;
}

export interface InstallVerification {
  phase: VerificationPhase;
  /** Where the latest run stands. A refused start leaves the previous answer in place. */
  outcome: VerifyOutcome | null;
  /** The server refused to start a run, so nothing was checked. */
  error: string;
  /** The tab didn't open: the page, for the visitor to open by hand. */
  blockedUrl: string | null;
  /** Call straight from the click or submit handler, or the browser blocks the new tab. */
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
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  const callbacks = useRef({ onVerified, onCheckingChange });
  useEffect(() => {
    callbacks.current = { onVerified, onCheckingChange };
  });

  /** The current run. Moving it on is what stops one: every late answer compares against this. */
  const runRef = useRef(0);
  const popupRef = useRef<Window | null>(null);
  const browserRef = useRef<BrowserReport | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!popupRef.current || event.source !== popupRef.current) return;
      const report = readBrowserMessage(event.data);
      if (report) browserRef.current = report;
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      runRef.current += 1;
      clearTimeout(pollTimer.current);
      clearTimeout(giveUpTimer.current);
      callbacks.current.onCheckingChange?.(false);
    };
  }, []);

  function closePopup() {
    try {
      popupRef.current?.close();
    } catch {
      // Already gone.
    }
    popupRef.current = null;
  }

  function endRun() {
    runRef.current += 1;
    clearTimeout(pollTimer.current);
    clearTimeout(giveUpTimer.current);
    setPhase("idle");
    callbacks.current.onCheckingChange?.(false);
  }

  function finish(result: VerifyOutcome) {
    endRun();
    setOutcome(result);
    if (result.status !== "verified") return;
    setBlockedUrl(null);
    closePopup();
    callbacks.current.onVerified();
  }

  async function poll(run: number, id: string, misses: number) {
    const res = await pollVerificationAction({ id, browser: browserRef.current }).catch(() => null);
    if (run !== runRef.current) return;

    if (res?.ok) {
      if (res.data.final) {
        finish(res.data);
        return;
      }
      setOutcome(res.data);
    } else if (misses + 1 >= POLL_MISS_LIMIT) {
      finish(lostOutcome(res?.message));
      return;
    }
    const missed = res?.ok ? 0 : misses + 1;
    pollTimer.current = setTimeout(() => void poll(run, id, missed), VERIFY_POLL_MS);
  }

  async function begin(run: number, tab: Window | null, input: VerificationInput) {
    const res = await startVerificationAction(input).catch(() => null);
    if (run !== runRef.current) {
      // The dialog closed first, so this tab is still blank and nothing will ever fill it.
      tab?.close();
      return;
    }

    if (!res?.ok) {
      closePopup();
      endRun();
      setError(res?.fieldErrors?.url ?? res?.message ?? "We couldn’t check that page. Try again.");
      return;
    }

    const { id, openUrl, outcome: first } = res.data;
    try {
      if (!tab || tab.closed) setBlockedUrl(openUrl);
      else tab.location.href = openUrl;
    } catch {
      setBlockedUrl(openUrl);
    }

    if (first.final) {
      finish(first);
      return;
    }
    setOutcome(first);
    setPhase("polling");
    giveUpTimer.current = setTimeout(() => {
      if (run === runRef.current) finish(lostOutcome());
    }, VERIFY_GIVE_UP_MS);
    pollTimer.current = setTimeout(() => void poll(run, id, 0), VERIFY_POLL_MS);
  }

  function start(input: VerificationInput) {
    if (phase !== "idle") return;
    runRef.current += 1;
    closePopup(); // The last run's tab: this run opens its own.
    browserRef.current = null;

    let tab: Window | null = null;
    try {
      tab = window.open("about:blank", "_blank");
    } catch {
      // Treated as blocked below.
    }
    popupRef.current = tab;

    setError("");
    setBlockedUrl(null);
    setPhase("starting");
    callbacks.current.onCheckingChange?.(true);
    void begin(runRef.current, tab, input);
  }

  function reset() {
    setOutcome(null);
    setError("");
    setBlockedUrl(null);
  }

  return { phase, outcome, error, blockedUrl, start, reset, clearError: () => setError("") };
}
