"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { CodeBox } from "@/components/install/code-box";
import { Connector, StepNum } from "@/components/install/step-marks";
import { useInstallVerification } from "@/components/install/use-install-verification";
import { VerifyStep } from "@/components/install/verify-step";
import { pixelCheckUrl, pixelDefaultUrl, pixelUrlError, type Project } from "@/lib/projects";
import { buildInstallSnippet } from "@/lib/snippet";
import { cn } from "@/lib/utils";

/*
 * Two-step pixel setup: one snippet (`lib/snippet.ts`, D10) for the site's `<head>` or a Google Tag
 * Manager Custom HTML tag, as Mida does (2026-11-09: the separate GTM tab was removed), then a check
 * from the server (`components/install`, `lib/install-verification.ts`).
 */

const ACCENT = "#0070C9";
const ACCENT_TINT = "#E6F4FF";
const ACCENT_INK = "#0060AD";
const ACCENT_LINE = "#B3DBFF";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";
const btnBase = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] whitespace-nowrap disabled:cursor-default disabled:opacity-45 ${focusRing}`;
const primaryClass = `${btnBase} border-0 bg-[#0070C9] px-4 font-semibold text-white hover:enabled:brightness-[.8]`;
const linkClass = `inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-[13px] font-medium hover:enabled:text-[#111827] disabled:cursor-default disabled:opacity-45 ${focusRing}`;

type Step = 1 | 2;

export interface PixelSetupDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  initialStep?: Step;
  /** The SDK URL the snippet loads (`env.SDK_URL`, passed from the server). */
  sdkUrl: string;
  onVerified(projectId: string): void;
}

export function PixelSetupDialog({
  project,
  open,
  onOpenChange,
  initialStep = 1,
  sdkUrl,
  onVerified,
}: PixelSetupDialogProps) {
  return (
    <DialogPrimitive.Root open={open && !!project} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4">
          {project ? (
            <PixelPanel
              project={project}
              initialStep={initialStep}
              sdkUrl={sdkUrl}
              onClose={() => onOpenChange(false)}
              onVerified={onVerified}
            />
          ) : null}
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PixelPanel({
  project,
  initialStep,
  sdkUrl,
  onClose,
  onVerified,
}: {
  project: Project;
  initialStep: Step;
  sdkUrl: string;
  onClose(): void;
  onVerified(projectId: string): void;
}) {
  const [step, setStep] = useState<Step>(initialStep);
  const [url, setUrl] = useState(pixelDefaultUrl(project.domain, project.protocol));
  const [attempted, setAttempted] = useState(false);
  const verification = useInstallVerification({
    onVerified: () => onVerified(project.id),
  });

  const checking = verification.phase !== "idle";
  const found = verification.outcome?.status === "verified";
  const domain = project.domain;
  const snippet = buildInstallSnippet({ sdkUrl, publicSiteId: project.key });
  const urlErr = pixelUrlError(url, domain);
  const showUrlErr = attempted && !!urlErr;

  function goTo(n: Step) {
    if (checking) return;
    setStep(n);
    // A found result survives navigation; a miss is cleared when the user goes back to fix it.
    if (n === 1 && !found) verification.reset();
  }

  function runCheck(e: React.FormEvent) {
    e.preventDefault();
    if (checking) return;
    setAttempted(true);
    if (urlErr) return;
    verification.start({
      websiteId: project.id,
      url: pixelCheckUrl(url, project.protocol),
      // The one snippet: the check finds it in the page or in a published GTM container.
      method: "MANUAL",
    });
  }

  return (
    <DialogPrimitive.Content
      aria-describedby={undefined}
      className="relative flex h-[720px] max-h-[calc(100vh-32px)] w-full max-w-[680px] animate-[rt-dlg_.16s_ease-out] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none motion-reduce:animate-none"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#EEF0F3] py-3 pr-3.5 pl-5 max-[641px]:py-2.5 max-[641px]:pr-2.5 max-[641px]:pl-3">
        <ol
          aria-label="Setup steps"
          className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0"
        >
          {(["Install pixel", "Verify"] as const).map((label, i) => {
            const n = (i + 1) as Step;
            const cur = n === step;
            const done = n < step || found;
            return (
              <li key={label} className="flex flex-none items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => goTo(n)}
                  aria-current={cur ? "step" : undefined}
                  disabled={checking}
                  className={cn(
                    "flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 pr-3 pl-1.5 text-[13px] whitespace-nowrap disabled:cursor-default disabled:opacity-45",
                    focusRing,
                  )}
                  style={{
                    background: cur ? "#F3F4F6" : "transparent",
                    color: done ? "#166534" : cur ? "#111827" : "#4B5563",
                    fontWeight: cur ? 600 : 500,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex size-[22px] flex-[0_0_22px] items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      border: `1.5px solid ${done ? "#16A34A" : cur ? ACCENT : "#D1D5DB"}`,
                      background: done ? "#16A34A" : cur ? ACCENT_TINT : "#FFFFFF",
                      color: done ? "#FFFFFF" : cur ? ACCENT_INK : "#6B7280",
                    }}
                  >
                    {done ? <CheckIcon size={11} width={3.2} /> : n}
                  </span>
                  {label}
                </button>
                {n < 2 ? (
                  <span
                    aria-hidden="true"
                    className="block h-0.5 w-6 rounded-sm"
                    style={{ background: step > 1 ? ACCENT_LINE : "#E5E7EB" }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "inline-flex size-8 flex-[0_0_32px] cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-[#6B7280] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]",
            focusRing,
          )}
        >
          <XIcon size={18} width={2} />
        </DialogPrimitive.Close>
      </div>

      <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto px-7 py-6 max-[641px]:px-4 max-[641px]:py-5">
        {step === 1 ? (
          <>
            <DialogPrimitive.Title className="m-0 text-lg leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]">
              Add the Routely script to your site
            </DialogPrimitive.Title>

            <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
              <li className="relative flex min-w-0 items-start gap-3">
                <Connector />
                <StepNum n={1} />
                <div className="flex min-w-0 flex-auto flex-col gap-2.5 pt-0.5">
                  <span className="text-sm leading-[22px] font-semibold text-[#111827]">
                    Copy the script and paste it into the header or Google Tag Manager
                  </span>
                  <CodeBox code={snippet} />
                </div>
              </li>
              <li className="flex items-start gap-3">
                <StepNum n={2} />
                <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                  <span className="text-sm leading-[22px] font-semibold text-[#111827]">
                    Publish your changes
                  </span>
                  <span className="text-sm leading-5 text-pretty text-[#4B5563]">
                    Then continue to check that Routely can see the script.
                  </span>
                </div>
              </li>
            </ol>
          </>
        ) : (
          <VerifyStep
            domain={domain}
            verification={verification}
            url={url}
            setUrl={(v) => {
              setUrl(v);
              verification.clearError();
            }}
            urlErr={showUrlErr ? urlErr : verification.error}
            onSubmit={runCheck}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] bg-white px-6 py-3.5 max-[641px]:px-4 max-[641px]:py-3 max-[641px]:*:flex-auto max-[641px]:*:justify-center">
        {step === 1 ? (
          <>
            <button type="button" onClick={onClose} className={cn(linkClass, "text-[#4B5563]")}>
              I’ll set this up later
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className={cn(primaryClass, "max-[641px]:h-11")}
            >
              Next: Verify installation
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => goTo(1)}
              disabled={checking}
              className={cn(linkClass, "text-[#374151]")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 12H5" />
                <path d="m11 6-6 6 6 6" />
              </svg>
              Back
            </button>
            {found ? (
              <button
                type="button"
                onClick={onClose}
                className={cn(primaryClass, "max-[641px]:h-11")}
              >
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  btnBase,
                  "border border-[#E5E7EB] bg-white px-4 font-medium text-[#374151] hover:enabled:bg-[#F9FAFB] max-[641px]:h-11",
                )}
              >
                I’ll finish later
              </button>
            )}
          </>
        )}
      </div>
    </DialogPrimitive.Content>
  );
}

interface IconProps {
  size: number;
  width: number;
}

function CheckIcon({ size, width }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon({ size, width }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
