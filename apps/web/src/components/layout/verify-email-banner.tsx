"use client";

import { useState } from "react";

import { InfoIcon } from "@/components/rt/icons";
import { resendVerificationAction } from "@/server/actions/account.actions";

type State = { kind: "idle" | "sending" | "sent" } | { kind: "error"; message: string };

/**
 * Shown above every page until a password account confirms its address. Not in the design: an
 * unverified account receives no notification emails and cannot invite teammates, so the way to
 * get a fresh link has to be somewhere the user will see it. Styled as the design's info notices.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const resend = async () => {
    setState({ kind: "sending" });
    const res = await resendVerificationAction().catch(() => null);
    if (res?.ok) setState({ kind: "sent" });
    else
      setState({ kind: "error", message: res?.message ?? "We couldn’t send the link. Try again." });
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-[#CCE7FF] bg-[#F0F7FF] px-4 py-3"
    >
      <span aria-hidden className="mt-px inline-flex flex-none text-[#0070C9]">
        <InfoIcon />
      </span>
      <p className="m-0 min-w-0 flex-1 text-sm leading-5 text-[#1F2937]">
        <span className="font-semibold">Confirm your email address.</span> We sent a link to{" "}
        <span className="font-medium">{email}</span>. Until you follow it you won’t get notification
        emails or be able to invite teammates.
        {state.kind === "sent" ? (
          <span className="text-[#15803D]"> A new link is on its way.</span>
        ) : state.kind === "error" ? (
          <span className="text-[#B91C1C]"> {state.message}</span>
        ) : null}
      </p>
      {state.kind !== "sent" ? (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state.kind === "sending"}
          className="h-5 cursor-pointer border-0 bg-transparent p-0 text-sm leading-5 font-semibold whitespace-nowrap text-[#0060AD] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] disabled:cursor-default disabled:opacity-60"
        >
          {state.kind === "sending" ? "Sending…" : "Resend link"}
        </button>
      ) : null}
    </div>
  );
}
