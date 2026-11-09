"use client";

import { Dialog as DialogPrimitive } from "radix-ui";

import { Spinner } from "@/components/rt/icons";
import { btn } from "@/components/rt/styles";
import type { InstallMethodName } from "@/lib/install-verification";
import { cn } from "@/lib/utils";

import { MethodTabs, methodPanelProps } from "./method-tabs";
import type { InstallVerification } from "./use-install-verification";
import { VerificationResult } from "./verification-result";
import { CHECKING_OUTCOME, verifyButtonLabel } from "./verification-state";

/** The install dialogs' second step: which page, then what the check found. */
export function VerifyStep({
  domain,
  method,
  onMethodChange,
  verification,
  url,
  setUrl,
  urlErr,
  onSubmit,
}: {
  domain: string;
  method: InstallMethodName;
  onMethodChange(method: InstallMethodName): void;
  verification: InstallVerification;
  url: string;
  setUrl(v: string): void;
  urlErr: string;
  onSubmit(e: React.FormEvent): void;
}) {
  const { phase, outcome } = verification;
  const checking = phase !== "idle";
  const shown = checking ? CHECKING_OUTCOME : outcome;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <MethodTabs value={method} onChange={onMethodChange} disabled={checking} className="mb-2" />
        <DialogPrimitive.Title className="m-0 text-lg leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]">
          Verify your installation
        </DialogPrimitive.Title>
        <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
          {method === "GTM"
            ? `Enter a page on ${domain} where your tag runs. Routely checks that the page loads your Google Tag Manager container, and that its published version holds this project’s code with the anti-flicker block.`
            : `Enter a page on ${domain} where you added the script. Routely checks that this project’s code is in the page.`}
        </p>
      </div>

      <div {...methodPanelProps(method)} className="flex flex-col gap-5">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1.5">
          <label htmlFor="rt-pm-url" className="text-[13px] font-medium text-[#374151]">
            Page URL
          </label>
          <div className="flex flex-wrap gap-2.5">
            <input
              id="rt-pm-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={checking}
              placeholder={`https://${domain}/`}
              aria-invalid={!!urlErr}
              aria-describedby={urlErr ? "rt-pm-url-help" : undefined}
              className="h-11 min-w-0 flex-[1_1_260px] rounded-lg border border-[#E5E7EB] bg-white px-3 text-[14px] text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] aria-invalid:border-[#DC2626] aria-invalid:focus:border-[#DC2626] aria-invalid:focus:shadow-[0_0_0_3px_rgba(220,38,38,.12)]"
            />
            <button type="submit" disabled={checking} className={cn(btn.primary, "h-11 flex-none")}>
              {checking ? <Spinner size={15} strokeWidth={2.4} /> : null}
              {verifyButtonLabel(phase, outcome)}
            </button>
          </div>
          {urlErr ? (
            <p
              id="rt-pm-url-help"
              role="alert"
              className="m-0 text-[13px] leading-[19px] text-[#B91C1C]"
            >
              {urlErr}
            </p>
          ) : null}
        </form>

        {shown ? <VerificationResult outcome={shown} /> : null}
      </div>
    </>
  );
}
