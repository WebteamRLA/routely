"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import {
  armColorClass,
  PRIMARY_METRIC_LABEL,
  type WizardActiveExperiment,
  type WizardValues,
  type WizardWebsite,
} from "@/components/experiments/wizard/wizard-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { armShares } from "@/lib/traffic";
import { controlUrlsConflict, isSameSite, isSameUrl, normalizeUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { PixelSetupDialog } from "@/components/get-started/pixel-setup-dialog";
import type { FormState } from "@/lib/form-state";
import type { WizardStepKey } from "@/lib/wizard-required";
import { checkInstallOnPageAction, type InstallCheckResult } from "@/server/actions/pixel.actions";

interface CheckResult {
  key: string;
  /** Rendered beside the row: a way to act on what the check found, where one exists. */
  action?: React.ReactNode;
  label: string;
  detail: string;
  status: "pass" | "warn" | "fail" | "pending";
  /** The step that holds whatever this check is about, for the review's "Review →" button. */
  step?: WizardStepKey;
}

/** The install check's lifecycle, kept separate from the rules computed synchronously. */
type InstallState =
  | { phase: "idle" }
  /** `previous` is the verdict still on screen while a re-check runs, so the row's own
   *  controls do not vanish underneath the click that started it. */
  | { phase: "checking"; previous?: InstallCheckResult }
  | { phase: "done"; result: InstallCheckResult };

/**
 * The pre-publish checklist, computed entirely client-side from values already on screen plus
 * context the page loaded up front (the actor's other active experiments). These mirror real
 * server-side rules — the same-site rule, the active-conflict rule, the URL-distinctness rule.
 *
 * The same-site rule is deliberately a warning here, not a blocking failure: unlike the other
 * two, `createExperimentAction` is the actual, unweakened enforcement of it (`assertSameSite` in
 * experiment.service.ts) — this client-side copy is only a heads-up while iterating on the
 * form, not a second gate, so it doesn't block "Acknowledge & create" for now.
 *
 * Script installation is deliberately not checked here for now — a draft doesn't need the pixel
 * verified yet, and re-adding that check later just means passing `receivingData` back in.
 */
function buildChecks(
  values: WizardValues,
  website: WizardWebsite | undefined,
  activeExperiments: WizardActiveExperiment[],
): CheckResult[] {
  const domain = website?.domain ?? "";

  const sameSite =
    website !== undefined &&
    isSameSite(values.controlUrl, domain) &&
    isSameSite(values.conversionUrl, domain) &&
    values.variants.every((variant) => isSameSite(variant.url, domain));

  const conflict = activeExperiments.find(
    (experiment) =>
      experiment.websiteId === values.websiteId &&
      controlUrlsConflict(
        { url: values.controlUrl, match: values.controlMatchType },
        { url: experiment.controlUrl, match: experiment.controlMatchType },
      ),
  );

  const allUrls = [
    values.controlUrl,
    ...values.variants.map((variant) => variant.url),
    values.conversionUrl,
  ];

  // Blank or unparseable URLs are separated out first, because they cannot take part in a
  // comparison: `isSameUrl` is false even against itself for those, so including them in the
  // duplicate scan below reported "two pages share a URL" for a form that was merely unfinished.
  const usableUrls = allUrls.filter((url) => normalizeUrl(url) !== null);
  const incomplete = usableUrls.length !== allUrls.length;

  // Every pair among control, every variant, and the goal must be distinct — two variants
  // sharing a URL is the same mistake between two arms instead of one.
  const distinct = usableUrls.every(
    (url, index) => usableUrls.findIndex((other) => isSameUrl(other, url)) === index,
  );

  return [
    {
      key: "same-site",
      label: "Same-site rule",
      status: sameSite ? "pass" : "warn",
      step: "profile",
      detail: sameSite
        ? `Every URL is on ${domain}.`
        : `Every URL must be on ${domain || "the website's domain"} or one of its subdomains — creating this will be rejected server-side until they are.`,
    },
    {
      key: "conflict",
      label: "No active conflict",
      status: conflict ? "fail" : "pass",
      step: "profile",
      detail: conflict
        ? `"${conflict.name}" is already active on this control URL. Pause or archive it first.`
        : "No other active experiment targets this control URL.",
    },
    {
      key: "variant-configuration",
      label: "Variant configuration",
      status: incomplete || !distinct ? "fail" : "pass",
      step: "profile",
      // Two different problems, so two different messages — telling someone with a half-filled
      // form that "no two can share a URL" sends them looking for a duplicate that isn't there.
      detail: incomplete
        ? "Every URL needs to be filled in, and each must be a full address including https://."
        : distinct
          ? "Control, every variant, and the goal are all distinct pages."
          : "Control, every variant, and the goal must all be different pages — no two can share a URL.",
    },
  ];
}

/**
 * The install check as a checklist row.
 *
 * Always a warning at worst, never a failure: an experiment is created as a draft, and a draft
 * with no snippet yet is a perfectly reasonable thing to have. It also cannot be proven
 * negative — a snippet injected by a tag manager runs in a browser but is invisible to a
 * server-side fetch of the raw HTML.
 */
function installCheck(state: InstallState, controlUrl: string): CheckResult {
  const base = { key: "install", label: "Script installation" };

  if (state.phase === "checking") {
    return {
      ...base,
      status: "pending",
      detail: `Loading ${controlUrl} to look for your snippet…`,
    };
  }

  if (state.phase === "idle") {
    return {
      ...base,
      status: "warn",
      detail: "Not checked — enter a valid control URL and reopen this dialog to check it.",
    };
  }

  if (!state.result.ok) {
    return { ...base, status: "warn", detail: state.result.message };
  }

  if (state.result.snippetFound) {
    return { ...base, status: "pass", detail: "The snippet is on your control page." };
  }

  return {
    ...base,
    status: "warn",
    detail: state.result.wrongSiteId
      ? "That page has a Routely snippet, but for a different website. It won't record anything for this experiment."
      : "We loaded your control page but couldn't find the snippet. You can still create this as a draft and install it before activating.",
  };
}

/** The status glyph: a 20px circle holding ✓, ! or a spinner. */
function StatusMark({ status }: { status: CheckResult["status"] }) {
  if (status === "pending") {
    return (
      <span
        aria-hidden
        className="mt-px size-5 flex-none animate-rl-spin rounded-full border-2 border-[#D5DEFB] border-t-primary"
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "mt-px grid size-5 flex-none place-items-center rounded-full text-[11px] font-black",
        status === "pass"
          ? "bg-success-bg text-success-text"
          : status === "warn"
            ? "bg-warning-bg text-warning-text"
            : "bg-danger text-white",
      )}
    >
      {status === "pass" ? "✓" : "!"}
    </span>
  );
}

function CheckRow({ check }: { check: CheckResult }) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-3 sm:flex-nowrap">
      <StatusMark status={check.status} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[13.5px] font-bold">{check.label}</p>
        <p className="text-[12.5px] leading-snug text-pretty text-ink-2">{check.detail}</p>
      </div>
      {check.action ? (
        <div className="ml-8 shrink-0 self-center sm:ml-0">{check.action}</div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Review body
// ---------------------------------------------------------------------------

export function SummaryStep({
  values,
  website,
  activeExperiments,
  onEdit,
}: {
  values: WizardValues;
  website: WizardWebsite | undefined;
  activeExperiments: WizardActiveExperiment[];
  /** Jumps back to a step from the review's Edit links and issue buttons. */
  onEdit: (step: WizardStepKey) => void;
}) {
  const checks = buildChecks(values, website, activeExperiments);
  const blocking = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const passed = checks.filter((check) => check.status === "pass");
  const [passedOpen, setPassedOpen] = useState(false);

  const shares = armShares({
    controlWeight: values.controlWeight,
    variantWeights: values.variants.map((variant) => variant.weight),
    trafficAllocation: values.trafficAllocation,
  });
  const armPercents = [shares.control, ...shares.variants];

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

  const readiness =
    blocking.length > 0
      ? {
          tone: "blocked" as const,
          title: "Action required before creating",
          sub: `${plural(blocking.length, "issue")} must be fixed before this experiment can be created.${warnings.length ? ` ${plural(warnings.length, "warning")} to review as well.` : ""}`,
        }
      : warnings.length > 0
        ? {
            tone: "warn" as const,
            title: "Ready to create",
            sub: `Nothing is blocking, but ${plural(warnings.length, "warning")} ${warnings.length === 1 ? "is" : "are"} worth a look first.`,
          }
        : {
            tone: "ready" as const,
            title: "Ready to create",
            sub: `All ${checks.length} checks passed. The script installation is checked when you continue.`,
          };

  return (
    <>
      <div className="flex flex-col gap-1.5 pt-1">
        <p className="text-xs font-extrabold tracking-[0.08em] text-coral uppercase">
          Review &amp; create
        </p>
        <h2 className="font-heading text-[clamp(22px,2.6vw,28px)] font-bold tracking-[-0.02em] text-pretty break-words">
          {values.name || "Untitled experiment"}
        </h2>
        <p className="text-sm leading-normal text-ink-2">
          Split URL test{website ? ` on ${website.name}` : ""}. It is created as a draft — nothing
          goes live until you start it from the experiment&apos;s page.
        </p>
      </div>

      <section
        className={cn(
          "overflow-hidden rounded-xl border",
          readiness.tone === "blocked"
            ? "border-danger-border bg-[#FFF7F5]"
            : readiness.tone === "warn"
              ? "border-warning-border bg-[#FFFBF2]"
              : "border-[#BFE3D1] bg-[#F3FAF6]",
        )}
      >
        <div className="flex items-start gap-4 px-[22px] py-5">
          <span
            aria-hidden
            className={cn(
              "grid size-9 flex-none place-items-center rounded-full text-[17px] font-black text-white",
              readiness.tone === "blocked" ? "bg-danger" : "bg-success",
            )}
          >
            {readiness.tone === "blocked" ? "!" : "✓"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-xl font-bold tracking-[-0.015em]">{readiness.title}</p>
            <p className="mt-1 text-sm leading-normal text-pretty text-[#2E3A52]">
              {readiness.sub}
            </p>
          </div>
        </div>

        {blocking.length > 0 ? (
          <IssueGroup
            title={`${plural(blocking.length, "blocking issue")} · must fix`}
            tone="fail"
            checks={blocking}
            onEdit={onEdit}
          />
        ) : null}

        {warnings.length > 0 ? (
          <IssueGroup
            title={`${plural(warnings.length, "warning")} · won’t block creating`}
            tone="warn"
            checks={warnings}
            onEdit={onEdit}
          />
        ) : null}

        {passed.length > 0 ? (
          <div className="border-t border-border bg-card">
            <button
              type="button"
              onClick={() => setPassedOpen((open) => !open)}
              aria-expanded={passedOpen}
              className="flex w-full cursor-pointer items-center justify-between px-[18px] py-3 text-left outline-none hover:bg-subtle focus-visible:ring-3 focus-visible:ring-primary/15"
            >
              <span className="flex items-center gap-2.5">
                <StatusMark status="pass" />
                <span className="text-[13.5px] font-bold">
                  {plural(passed.length, "check")} passed
                </span>
              </span>
              <span className="text-[12.5px] font-bold text-primary">
                {passedOpen ? "Hide" : "Show"}
              </span>
            </button>
            {passedOpen ? (
              <ul className="flex flex-col gap-2 pr-[18px] pb-3 pl-12">
                {passed.map((check) => (
                  <li key={check.key} className="text-[13px]">
                    <span className="font-bold">{check.label}</span>{" "}
                    <span className="text-ink-3">· {check.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 py-4">
          <h3 className="font-heading text-base font-bold tracking-[-0.01em]">
            Experiment summary
          </h3>
        </div>

        <SummaryRow label="Website" onEdit={() => onEdit("website")}>
          {website ? (
            <>
              <span className="font-bold">{website.name}</span>{" "}
              <span className="font-mono text-[13px] text-ink-3">{website.domain}</span>
            </>
          ) : (
            "—"
          )}
        </SummaryRow>

        <SummaryRow label="Control URL" onEdit={() => onEdit("profile")}>
          <UrlLine swatch={armColorClass(0)} url={values.controlUrl} />
        </SummaryRow>

        <SummaryRow
          label={values.variants.length === 1 ? "Variant URL" : "Variant URLs"}
          onEdit={() => onEdit("profile")}
        >
          <div className="flex flex-col gap-1.5">
            {values.variants.map((variant, index) => (
              <div key={variant.id ?? index} className="flex min-w-0 items-baseline gap-2">
                <span
                  aria-hidden
                  className={cn("size-2 flex-none rounded-[2px]", armColorClass(index + 1))}
                />
                <span className="flex-none text-[13px] font-extrabold">Variant {index + 1}</span>
                <span className="min-w-0 font-mono text-[13px] break-all text-ink-2">
                  {variant.url || "—"}
                </span>
              </div>
            ))}
          </div>
        </SummaryRow>

        <SummaryRow label="Conversion URL" onEdit={() => onEdit("metrics")}>
          <div className="flex min-w-0 items-baseline gap-2">
            <span aria-hidden className="size-[7px] flex-none rotate-45 bg-success" />
            <span className="min-w-0 font-mono text-[13px] break-all">
              {values.conversionUrl || "—"}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Exact URL · reaching this page counts as a conversion
          </p>
        </SummaryRow>

        <SummaryRow label="Traffic split" onEdit={() => onEdit("configuration")}>
          <div className="flex h-2 max-w-[360px] gap-0.5 overflow-hidden rounded-[4px]" aria-hidden>
            {armPercents.map((percent, index) =>
              percent > 0 ? (
                <div
                  key={index}
                  className={armColorClass(index)}
                  style={{ flexGrow: percent, flexBasis: 0 }}
                />
              ) : null,
            )}
            {shares.excluded > 0 ? (
              <div className="bg-divider" style={{ flexGrow: shares.excluded, flexBasis: 0 }} />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1">
            {armPercents.map((percent, index) => (
              <span key={index} className="text-[13px] text-ink-2">
                <span className="font-extrabold text-foreground tabular-nums">{percent}%</span>{" "}
                {index === 0 ? "Control" : `Variant ${index}`}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {values.trafficAllocation}% of visitors included
            {shares.excluded > 0 ? ` · ${shares.excluded}% not entered` : ""}
          </p>
        </SummaryRow>

        <SummaryRow label="Audience" onEdit={() => onEdit("audience")}>
          All visitors
        </SummaryRow>

        <SummaryRow label="Primary goal" onEdit={() => onEdit("metrics")}>
          <p className="font-extrabold">{PRIMARY_METRIC_LABEL[values.primaryMetric]}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-3">Goal type: Pageview</p>
        </SummaryRow>
      </section>
    </>
  );
}

function IssueGroup({
  title,
  tone,
  checks,
  onEdit,
}: {
  title: string;
  tone: "fail" | "warn";
  checks: CheckResult[];
  onEdit: (step: WizardStepKey) => void;
}) {
  return (
    <div
      className={cn(
        "border-t bg-card",
        tone === "fail" ? "border-danger-border" : "border-warning-border",
      )}
    >
      <p
        className={cn(
          "px-[18px] py-2.5 text-[11.5px] font-extrabold tracking-[0.08em] uppercase",
          tone === "fail" ? "text-danger-text" : "text-[#94600A]",
        )}
      >
        {title}
      </p>
      <ul>
        {checks.map((check) => (
          <li
            key={check.key}
            className={cn(
              "flex flex-wrap items-start gap-3 border-t px-[18px] py-3 sm:flex-nowrap",
              tone === "fail" ? "border-[#F8E1DC]" : "border-[#F7EBD3]",
            )}
          >
            <StatusMark status={check.status} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-snug font-bold">{check.label}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-pretty text-ink-2">
                {check.detail}
              </p>
            </div>
            {check.step ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-8 h-[30px] text-[12.5px] sm:ml-0"
                onClick={() => onEdit(check.step!)}
              >
                Review →
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryRow({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-1.5 border-t border-divider px-5 py-3.5">
      <div className="flex-[0_0_140px] pt-px text-[13px] font-bold text-ink-3">{label}</div>
      <div className="min-w-0 flex-[1_1_240px] text-[13.5px]">{children}</div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label.toLowerCase()}`}
        className="cursor-pointer p-0 text-[13px] font-bold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-primary/15"
      >
        Edit
      </button>
    </div>
  );
}

function UrlLine({ swatch, url }: { swatch: string; url: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span aria-hidden className={cn("size-2 flex-none rounded-[2px]", swatch)} />
      <span className="min-w-0 font-mono text-[13px] break-all">{url || "—"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The create dialog — the last gate, opened from the wizard's footer
// ---------------------------------------------------------------------------

export function CreateExperimentDialog({
  values,
  website,
  activeExperiments,
  formId,
  isPending,
  dialogOpen,
  onDialogOpenChange,
  sdkUrl,
  verifyAction,
}: {
  values: WizardValues;
  website: WizardWebsite | undefined;
  activeExperiments: WizardActiveExperiment[];
  formId: string;
  isPending: boolean;
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  sdkUrl: string;
  verifyAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [install, setInstall] = useState<InstallState>({ phase: "idle" });

  /**
   * Loads the control URL and looks for the snippet.
   *
   * Shared by the dialog opening and the row's own refresh button, so "check again" cannot
   * drift from "check on open" — they are the same request against the same URL.
   */
  async function runInstallCheck() {
    // Nothing to fetch until the control URL is a real address; `installCheck` explains the
    // idle state rather than reporting a failure the customer cannot act on.
    if (!website || normalizeUrl(values.controlUrl) === null) {
      setInstall({ phase: "idle" });
      return;
    }

    setInstall((current) => ({
      phase: "checking",
      previous: current.phase === "done" ? current.result : undefined,
    }));
    const result = await checkInstallOnPageAction({
      websiteId: website.id,
      url: values.controlUrl,
    });
    setInstall({ phase: "done", result });
  }

  /**
   * Runs when the dialog opens — from the event handler rather than an effect, so opening is
   * what triggers the request rather than a render reacting to state that already changed.
   * Re-checked on every open, since the control URL may have been edited in between.
   */
  async function handleOpenChange(open: boolean) {
    onDialogOpenChange(open);
    if (open) await runInstallCheck();
  }

  const install_ = installCheck(install, values.controlUrl);

  // The last settled verdict, which outlives an in-flight re-check.
  const settled =
    install.phase === "done"
      ? install.result
      : install.phase === "checking"
        ? install.previous
        : undefined;
  const installNeedsFixing =
    settled !== undefined && (settled.ok === false || !settled.snippetFound);

  const checks = [
    ...buildChecks(values, website, activeExperiments),
    {
      ...install_,
      /*
       * A failed install check is the one thing on this list the customer can fix without
       * leaving — the others are configuration they would go back a step to change, while this
       * one needs the snippet on their site. Opening the setup guide here means noticing the
       * problem and fixing it are the same click, and the check re-runs when the dialog is
       * reopened.
       */
      /*
       * Shown while a re-check is in flight too, judged on the verdict still displayed — a
       * button that disappears the moment it is pressed is a button that looks broken.
       */
      action:
        installNeedsFixing && website ? (
          <div className="flex items-center gap-2">
            <PixelSetupDialog
              website={website}
              sdkUrl={sdkUrl}
              verifyAction={verifyAction}
              triggerLabel="Set up pixel"
              triggerVariant="outline"
              /* The guide verifies the page this check is about, not the site root — otherwise
                 it reports success on a page the check never looks at. */
              verifyUrl={values.controlUrl}
            />
            {/* Installing the snippet happens on the customer's own site, in another tab or
             * another system entirely — so the answer can change without anything here
             * changing. Re-checking in place beats closing the dialog to make it run again. */}
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={runInstallCheck}
              disabled={install.phase === "checking"}
              aria-label="Check the script installation again"
            >
              <RefreshCw
                className={cn("size-4", install.phase === "checking" && "animate-spin")}
                aria-hidden
              />
            </Button>
          </div>
        ) : undefined,
    },
  ];
  const hasFailure = checks.some((check) => check.status === "fail");

  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => void handleOpenChange(open)}>
      <DialogTrigger asChild>
        <Button type="button" className="h-11 px-6 text-sm font-extrabold">
          Review &amp; create
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pre-publish check</DialogTitle>
          <DialogDescription>
            {hasFailure
              ? "Fix the issues below before creating this experiment."
              : "Everything checks out — warnings below won't block creating a draft."}
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-divider border-t border-divider">
          {checks.map((check) => (
            <CheckRow key={check.key} check={check} />
          ))}
        </ul>

        <div className="flex justify-end gap-2 border-t border-divider pt-4">
          <Button type="button" variant="outline" onClick={() => onDialogOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={hasFailure || isPending}>
            {isPending ? "Creating…" : "Acknowledge & create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One-line status for the footer beside the create button, from the synchronous checks. */
export function reviewHint(
  values: WizardValues,
  website: WizardWebsite | undefined,
  activeExperiments: WizardActiveExperiment[],
): { text: string; tone: "fail" | "warn" | "ok" } {
  const checks = buildChecks(values, website, activeExperiments);
  const failures = checks.filter((check) => check.status === "fail").length;
  if (failures > 0) {
    return {
      text: `${failures} issue${failures === 1 ? "" : "s"} to fix first`,
      tone: "fail",
    };
  }
  const warnings = checks.filter((check) => check.status === "warn").length;
  if (warnings > 0) {
    return { text: `${warnings} warning${warnings === 1 ? "" : "s"} to review`, tone: "warn" };
  }
  return { text: "Created as a draft", tone: "ok" };
}
