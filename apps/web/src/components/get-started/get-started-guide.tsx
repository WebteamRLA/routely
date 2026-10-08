"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";

import { InstallStep, ManualInstall } from "@/components/get-started/manual-install";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE, type FormState } from "@/lib/form-state";
import { PIXEL_STATUS, type PixelStatus } from "@/lib/pixel-status";
import type { SiteProtocol } from "@/generated/prisma/enums";
import { siteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";

/**
 * The install panel: copy the snippet, add it to `<head>`, verify it — drawn as the design's
 * single scrolling panel with three numbered rows rather than as a click-through wizard, so the
 * snippet, the instructions and the check are all visible at once.
 *
 * It renders the dialog's title and description itself, because the status pill beside the
 * title depends on the verification state held here. It is only ever mounted inside
 * `PixelSetupDialog`.
 *
 * Nothing here is invented: the status shown is the website's real pixel status as the server
 * resolved it, overridden only by the result of a check run in this panel. Progress is not
 * persisted — "pixel detected" is the one fact that outlives the panel, derived elsewhere.
 */

/** What the panel currently knows, most specific first. */
type CheckState = "checking" | "detected" | "missing" | PixelStatus;

const ROW: Record<CheckState, { label: string; className: string }> = {
  checking: { label: "Checking…", className: "bg-brand-tint-2 text-[#1F3FB0]" },
  detected: { label: "Detected", className: "bg-success-bg text-success-text" },
  missing: { label: "Not detected", className: "bg-danger-bg text-danger-text" },
  receiving: { label: PIXEL_STATUS.receiving.label, className: "bg-success-bg text-success-text" },
  connected: { label: PIXEL_STATUS.connected.label, className: "bg-success-bg text-success-text" },
  unknown: { label: "Not verified yet", className: "bg-divider text-ink-2" },
};

export function GetStartedGuide({
  website,
  sdkUrl,
  verifyAction,
  verifyUrl,
  startOnDone,
  pixelStatus,
  onDone,
}: {
  website: {
    id: string;
    name: string;
    domain: string;
    protocol: SiteProtocol;
    publicSiteId: string;
  };
  sdkUrl: string;
  verifyAction: (state: FormState, formData: FormData) => Promise<FormState>;
  /**
   * Page the Verify step checks, when the caller has a particular one in mind.
   *
   * The wizard's pre-publish check opens this guide about a *specific* page — the experiment's
   * control URL — so verifying the site root instead would answer a different question and
   * report success while the check that sent them here still fails.
   */
  verifyUrl?: string;
  /** The website is already known to be set up, so the panel opens showing it as installed. */
  startOnDone: boolean;
  /** The server-resolved status, when the caller has it; finer than `startOnDone`. */
  pixelStatus?: PixelStatus;
  /** Dismisses the guide. The caller decides what that means — closing its dialog, here. */
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(verifyAction, IDLE);
  // The failure message is instructional — check the <head>, clear the cache — so it must not
  // vanish on a timer while the customer is acting on it. `useFormToast` gives errors no
  // duration, so this one stays until dismissed.
  useFormToast(state, { success: "Snippet found — your pixel is connected." });

  const base: PixelStatus = pixelStatus ?? (startOnDone ? "connected" : "unknown");
  const check: CheckState = isPending
    ? "checking"
    : state.status === "success"
      ? "detected"
      : state.status === "error"
        ? "missing"
        : base;
  const installed = check === "detected" || check === "receiving" || check === "connected";
  const row = ROW[check];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3.5 border-b border-divider py-5 pr-14 pl-[22px]">
        <div className="min-w-0 flex-[1_1_320px]">
          <DialogTitle>Install the Routely snippet</DialogTitle>
          <DialogDescription className="mt-1">
            Install once on {website.domain}. The same snippet powers every experiment on{" "}
            {website.name}.
          </DialogDescription>
        </div>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-sm border px-3 text-[12.5px] font-extrabold whitespace-nowrap",
            check === "checking"
              ? "border-[#D5DEFB] bg-brand-tint text-[#1F3FB0]"
              : installed
                ? "border-success-border bg-success-bg text-success-strong"
                : "border-danger-border bg-danger-bg-2 text-danger-text",
          )}
        >
          {check === "checking" ? (
            <span
              aria-hidden
              className="size-3 animate-rl-spin rounded-full border-2 border-[#D5DEFB] border-t-brand"
            />
          ) : (
            <span aria-hidden>{installed ? "✓" : "✕"}</span>
          )}
          {check === "checking"
            ? "Checking…"
            : installed
              ? "Installed"
              : check === "missing"
                ? "Not detected"
                : "Not installed"}
        </span>
      </div>

      {installed ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-success-border bg-success-bg-2 px-[22px] py-4">
          <span
            aria-hidden
            className="grid size-[30px] shrink-0 place-items-center rounded-full bg-success font-black text-white"
          >
            ✓
          </span>
          <div className="min-w-0 flex-[1_1_260px]">
            <p className="font-heading text-[15.5px] font-bold text-success-strong">
              Routely is installed and ready
            </p>
            <p className="mt-0.5 text-[13px] text-pretty text-[#2E5D49]">
              {check === "detected"
                ? `Snippet found on ${website.domain} just now.`
                : `${PIXEL_STATUS[base].hint} on ${website.domain}.`}{" "}
              It starts recording as soon as an experiment is running on a page it covers.
            </p>
          </div>
          {/* One way out, rather than two onward journeys. Someone who just finished setup
              wants to see it took effect; sending them straight into the experiment form
              skips the confirmation they came for. */}
          <Button
            className="border-success bg-success hover:border-[#0F8A5C] hover:bg-[#0F8A5C]"
            onClick={onDone}
          >
            Done
          </Button>
        </div>
      ) : null}

      <ManualInstall
        sdkUrl={sdkUrl}
        publicSiteId={website.publicSiteId}
        domain={website.domain}
        done={installed}
      />

      <form action={formAction}>
        <input type="hidden" name="websiteId" value={website.id} />
        <InstallStep
          n={3}
          title="Verify installation"
          tone={installed ? "done" : "next"}
          className="border-b-0"
          aside={
            <SubmitButton variant={installed ? "outline" : "default"} pendingLabel="Checking…">
              {installed ? "Verify again" : "Verify installation"}
            </SubmitButton>
          }
        >
          <div className="space-y-1.5">
            <Label htmlFor="verify-url">Page to check</Label>
            <Input
              id="verify-url"
              name="url"
              defaultValue={verifyUrl ?? siteUrl(website)}
              placeholder={verifyUrl ?? siteUrl(website)}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={state.fieldErrors?.["url"]?.length ? true : undefined}
              className="font-mono text-[13px]"
            />
            {state.fieldErrors?.["url"]?.length ? (
              <p className="text-[12.5px] font-semibold text-danger-text">
                {state.fieldErrors["url"].join(" ")}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2.5 rounded-lg border border-divider px-3 py-2.5">
            <span className="min-w-0 truncate font-mono text-[13px]">{website.domain}</span>
            <span
              aria-live="polite"
              className={cn(
                "shrink-0 rounded-sm px-2 py-[3px] text-[12px] font-extrabold whitespace-nowrap",
                row.className,
              )}
            >
              {row.label}
            </span>
          </div>

          <p className="text-[12.5px] text-pretty text-ink-3">
            {installed
              ? `Every experiment on ${website.domain} uses this installation. Nothing to set up per experiment.`
              : `Any page on ${website.domain} that has the snippet. We load it and look for your site id in the HTML.`}
          </p>
        </InstallStep>
      </form>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2.5 border-t border-divider bg-card px-[22px] py-3.5">
        <span className="text-[12.5px] text-ink-3">
          Website-level · shared by every experiment on {website.name}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone}>
            {installed ? "Close" : "I'll do this later"}
          </Button>
        </div>
      </div>
    </div>
  );
}
