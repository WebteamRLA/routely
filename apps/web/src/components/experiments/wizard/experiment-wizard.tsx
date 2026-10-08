"use client";

import { useActionState, useState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";

import {
  AudienceStep,
  ConfigurationStep,
  MetricsStep,
  ProfileStep,
  WebsiteStep,
  type TrafficArm,
} from "@/components/experiments/wizard/wizard-steps";
import { WizardRail } from "@/components/experiments/wizard/wizard-rail";
import { WizardStepper } from "@/components/experiments/wizard/wizard-stepper";
import {
  CreateExperimentDialog,
  reviewHint,
  SummaryStep,
} from "@/components/experiments/wizard/wizard-summary";
import {
  type FieldErrors,
  firstIncompleteStep,
  hasErrors,
  requiredFieldErrors,
} from "@/lib/wizard-required";
import type {
  WizardActiveExperiment,
  WizardValues,
  WizardWebsite,
} from "@/components/experiments/wizard/wizard-types";
import { Button } from "@/components/ui/button";
import { IDLE, type FormState } from "@/lib/form-state";
import { siteOrigin } from "@/lib/site-url";
import { applyShare, armShares, roundToTotal } from "@/lib/traffic";
import { cn } from "@/lib/utils";

type StepKey = "website" | "profile" | "audience" | "metrics" | "configuration" | "summary";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "website", label: "Website" },
  { key: "profile", label: "Name & URLs" },
  { key: "audience", label: "Audience" },
  { key: "metrics", label: "Goal" },
  { key: "configuration", label: "Traffic" },
  { key: "summary", label: "Review" },
];

/** Which fields live on which step, so a server-side field error can jump back to it. */
const STEP_FIELDS: Record<StepKey, (keyof WizardValues)[]> = {
  website: ["websiteId"],
  profile: ["name", "description", "controlUrl", "variants"],
  audience: [],
  metrics: ["conversionUrl", "conversionMatchType", "primaryMetric"],
  configuration: ["controlMatchType", "controlWeight", "trafficAllocation"],
  summary: [],
};

const FORM_ID = "experiment-wizard-form";

/** Step keys in wizard order, for the "which step is still incomplete" search. */
const STEP_ORDER = STEPS.map((item) => item.key);

/** The step a field-error key belongs to; `variants.0` and friends belong with `variants`. */
function stepOfField(field: string): number {
  const base = field.split(".")[0] as keyof WizardValues;
  return STEPS.findIndex((item) => STEP_FIELDS[item.key].includes(base));
}

/**
 * The multi-step experiment creation flow.
 *
 * Every step's fields live in **one** real `<form>` for the whole wizard — a step that isn't
 * current is hidden with the `hidden` attribute, not unmounted, so its inputs still submit
 * along with everything else when the review step's dialog confirms. State is still lifted to
 * React (rather than left fully uncontrolled) because the summary rail and the review's
 * pre-publish check need to read live values as the customer types, not just at submit time.
 */
export function ExperimentWizard({
  action,
  websites,
  activeExperiments,
  preselectedWebsiteId,
  sdkUrl,
  verifyAction,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  websites: WizardWebsite[];
  activeExperiments: WizardActiveExperiment[];
  preselectedWebsiteId?: string;
  /** Passed through to the review, whose install check can open the pixel setup guide. */
  sdkUrl: string;
  verifyAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  // Paired with the step-jumping below: the toast says what went wrong, the jump puts the
  // customer where they can fix it.
  useFormToast(state);
  /**
   * Arriving with a website already chosen — from the websites table's "New experiment" button,
   * which links to `?websiteId=` — skips straight to Profile. Step 1 is marked complete rather
   * than hidden, so the choice is still visible and can be changed by clicking back to it.
   */
  const startsOnProfile = websites.some((candidate) => candidate.id === preselectedWebsiteId);

  const [step, setStep] = useState<StepKey>(startsOnProfile ? "profile" : "website");
  const [maxStepIndex, setMaxStepIndex] = useState(startsOnProfile ? 1 : 0);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Lifted out of props so a website created from the wizard's own dialog can be appended and
  // selected immediately, without a round trip back to the server that built this page.
  const [websiteList, setWebsiteList] = useState(websites);
  /**
   * Blank-required-field messages raised in the browser. Kept separate from the server's
   * `fieldErrors` so a fresh submit response replaces the server's half without resurrecting a
   * stale client message, and so clearing one never clears the other.
   */
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  const [values, setValues] = useState<WizardValues>({
    websiteId: preselectedWebsiteId ?? websites[0]?.id ?? "",
    name: "",
    description: "",
    controlUrl: "",
    controlMatchType: "EXACT",
    controlWeight: 50,
    variants: [{ url: "", weight: 50 }],
    conversionUrl: "",
    conversionMatchType: "EXACT",
    primaryMetric: "CONVERSION_RATE",
    trafficAllocation: 100,
  });

  function set<K extends keyof WizardValues>(key: K, value: WizardValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function setVariantUrl(index: number, url: string) {
    setValues((previous) => ({
      ...previous,
      variants: previous.variants.map((variant, i) =>
        i === index ? { ...variant, url } : variant,
      ),
    }));
  }

  function removeVariant(index: number) {
    setValues((previous) => ({
      ...previous,
      variants:
        previous.variants.length > 1
          ? previous.variants.filter((_, i) => i !== index)
          : previous.variants,
    }));
  }

  /**
   * Traffic is edited as two independent facts, exactly as it is stored: how the included
   * traffic divides between the arms (always adding to 100), and what share of visitors is
   * included at all (`trafficAllocation`). Because the weights are relative, the arm
   * percentages are stored verbatim as weights — see `lib/traffic.ts`.
   */
  const weights = [values.controlWeight, ...values.variants.map((variant) => variant.weight)];
  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0);
  const armPercents = roundToTotal(
    weights.map((weight) =>
      weightTotal > 0 ? (Math.max(weight, 0) / weightTotal) * 100 : 100 / weights.length,
    ),
    100,
  );

  function writeArmPercents(next: number[]) {
    // Every arm at 0 cannot be drawn from; keep the previous weights rather than store that.
    if (!next.some((percent) => percent > 0)) return;
    setValues((previous) => ({
      ...previous,
      controlWeight: next[0] ?? 0,
      variants: previous.variants.map((variant, index) => ({
        ...variant,
        weight: next[index + 1] ?? 0,
      })),
    }));
  }

  function setArmPercent(index: number, percent: number) {
    // With no excluded slot to absorb the change, the other arms give way proportionally —
    // with two arms that is simply the other one.
    writeArmPercents(applyShare(armPercents, index, percent, -1));
  }

  function splitEvenly() {
    writeArmPercents(
      roundToTotal(
        armPercents.map(() => 100 / armPercents.length),
        100,
      ),
    );
  }

  function setAllocation(percent: number) {
    // trafficAllocation has a floor of 1: excluding literally everyone is an experiment that
    // can never record anything.
    const clamped = Math.round(Math.min(Math.max(Number.isFinite(percent) ? percent : 1, 1), 100));
    set("trafficAllocation", clamped);
  }

  const stepIndex = STEPS.findIndex((item) => item.key === step);

  // A field error on a step other than the one showing means the customer submitted from the
  // review step's dialog with a mistake made several steps earlier — jump back to it rather
  // than leaving the failure invisible behind the currently-visible step.
  //
  // Handled as a render-time adjustment rather than an effect (React's own recommended pattern
  // for "update state in response to a value changing"): comparing against the last-handled
  // state and calling setState synchronously during render avoids the extra commit-then-effect
  // render pass that `useEffect` would cost here.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);

    if (state.status === "error" && state.fieldErrors) {
      const errorFields = new Set(Object.keys(state.fieldErrors));
      const target =
        errorFields.size > 0 && !STEP_FIELDS[step].some((field) => errorFields.has(field))
          ? STEPS.find((item) => STEP_FIELDS[item.key].some((field) => errorFields.has(field)))
          : undefined;

      if (target) {
        setDialogOpen(false);
        setStep(target.key);
        setMaxStepIndex((previous) =>
          Math.max(
            previous,
            STEPS.findIndex((item) => item.key === target.key),
          ),
        );
      }
    }
  }

  /**
   * Required fields, checked in the browser before a step is allowed to advance.
   *
   * The rules themselves live in `lib/wizard-required.ts` — pure, and unit-tested without a
   * DOM. The server schema is still the authority on validity; this only checks presence, and
   * exists for the feedback moment: "Continue" is a `type="button"`, so it never triggers the
   * browser's own constraint validation, and without this a customer could walk an empty form
   * all the way to Review and only then be told.
   *
   * It also removes a worse failure. Steps that are not current stay mounted and are hidden
   * with the `hidden` attribute so their inputs still submit. A `required` input inside a
   * hidden element cannot be focused, so the browser refuses the submission and reports it to
   * the console rather than to the page — the form would simply appear to do nothing. Gating
   * each step means a blank required field can no longer reach that point.
   */
  function requiredErrors(target: StepKey): FieldErrors {
    return requiredFieldErrors(target, values);
  }

  function goTo(next: StepKey) {
    const nextIndex = STEPS.findIndex((item) => item.key === next);
    if (nextIndex > maxStepIndex) return;
    setStep(next);
  }

  function advance() {
    const blocking = requiredErrors(step);

    if (hasErrors(blocking)) {
      setClientErrors(blocking);
      return;
    }

    setClientErrors({});
    const nextIndex = Math.min(stepIndex + 1, STEPS.length - 1);
    setMaxStepIndex((previous) => Math.max(previous, nextIndex));
    setStep(STEPS[nextIndex]!.key);
  }

  /**
   * Opening the create dialog is the last gate before submission, so it is where a blank
   * required field on an *earlier* step has to be caught.
   *
   * Reachable despite the per-step checks: the stepper allows jumping back to any visited
   * step, so a customer can clear a filled field and then skip forward again. Rather than
   * opening a review of an experiment that cannot be created, this sends them to the step that
   * needs attention with the message already showing.
   */
  function openReview(open: boolean) {
    if (open) {
      const incomplete = firstIncompleteStep(STEP_ORDER, values);

      if (incomplete) {
        setClientErrors(requiredErrors(incomplete));
        setStep(incomplete);
        return;
      }

      setClientErrors({});
    }

    setDialogOpen(open);
  }

  function back() {
    setStep(STEPS[Math.max(stepIndex - 1, 0)]!.key);
  }

  function handleWebsiteCreated(created: WizardWebsite) {
    setWebsiteList((previous) => [...previous, created]);
    set("websiteId", created.id);
  }

  const website = websiteList.find((candidate) => candidate.id === values.websiteId);
  const origin = website ? siteOrigin(website) : undefined;

  const shares = armShares({
    controlWeight: values.controlWeight,
    variantWeights: values.variants.map((variant) => variant.weight),
    trafficAllocation: values.trafficAllocation,
  });

  const trafficArms: TrafficArm[] = [
    {
      name: "Control",
      url: values.controlUrl,
      percent: armPercents[0] ?? 0,
      ofTotal: shares.control,
    },
    ...values.variants.map((variant, index) => ({
      name: `Variant ${index + 1}`,
      url: variant.url,
      percent: armPercents[index + 1] ?? 0,
      ofTotal: shares.variants[index] ?? 0,
    })),
  ];

  // The client's blank-field messages take precedence: they describe what is on screen right
  // now, whereas a server error refers to the payload of an earlier submit.
  const fieldErrors: FieldErrors = { ...state.fieldErrors, ...clientErrors };

  const errorIndexes = new Set(
    Object.entries(fieldErrors)
      .filter(([, messages]) => messages?.length)
      .map(([field]) => stepOfField(field))
      .filter((index) => index >= 0),
  );

  const isReview = step === "summary";
  const hint = isReview ? reviewHint(values, website, activeExperiments) : undefined;

  return (
    <div className="flex flex-col gap-[18px]">
      <WizardStepper
        steps={STEPS}
        currentIndex={stepIndex}
        maxIndex={maxStepIndex}
        errorIndexes={errorIndexes}
        onSelect={(key) => goTo(key as StepKey)}
      />

      <div className="flex items-start gap-5">
        <div
          className={cn("mx-auto flex min-w-0 flex-1 flex-col gap-4", isReview && "max-w-[880px]")}
        >
          <form id={FORM_ID} action={formAction} className="flex flex-col gap-4">
            {/* Lives at form level rather than inside the traffic step: it is a single value
             * with no field of its own, and the step that edits it is often not the visible one. */}
            <input type="hidden" name="controlWeight" value={values.controlWeight} />
            {/* Edited on the Traffic step as the "included" slider, which has no field of its
             * own — so the value needs carrying into the submission explicitly. */}
            <input type="hidden" name="trafficAllocation" value={values.trafficAllocation} />

            <div hidden={step !== "website"} className="flex flex-col gap-4">
              <WebsiteStep
                websites={websiteList}
                websiteId={values.websiteId}
                onSelect={(id) => set("websiteId", id)}
                onCreate={handleWebsiteCreated}
                errors={fieldErrors}
              />
            </div>

            <div hidden={step !== "profile"} className="flex flex-col gap-4">
              <ProfileStep
                values={values}
                onChange={set}
                onVariantUrlChange={setVariantUrl}
                onRemoveVariant={removeVariant}
                origin={origin}
                shares={shares}
                errors={fieldErrors}
              />
            </div>

            <div hidden={step !== "audience"} className="flex flex-col gap-4">
              <AudienceStep
                controlUrl={values.controlUrl}
                controlMatchType={values.controlMatchType}
              />
            </div>

            <div hidden={step !== "metrics"} className="flex flex-col gap-4">
              <MetricsStep
                conversionUrl={values.conversionUrl}
                conversionMatchType={values.conversionMatchType}
                primaryMetric={values.primaryMetric}
                controlUrl={values.controlUrl}
                variants={values.variants}
                onChangeText={(value) => set("conversionUrl", value)}
                origin={origin}
                errors={fieldErrors}
              />
            </div>

            <div hidden={step !== "configuration"} className="flex flex-col gap-4">
              <ConfigurationStep
                controlMatchType={values.controlMatchType}
                arms={trafficArms}
                trafficAllocation={values.trafficAllocation}
                onArmChange={setArmPercent}
                onSplitEvenly={splitEvenly}
                onAllocationChange={setAllocation}
                errors={fieldErrors}
              />
            </div>

            <div hidden={!isReview} className="flex flex-col gap-4">
              <SummaryStep
                values={values}
                website={website}
                activeExperiments={activeExperiments}
                onEdit={(key) => goTo(key)}
              />
            </div>
          </form>

          {/*
           * Back / Continue, pinned to the bottom of the scrolling content area so they sit in
           * the same place on every step. The negative bottom margin lets the bar run into the
           * shell's bottom padding, and the gradient fades content out beneath it.
           */}
          <div className="sticky bottom-0 z-[5] -mb-[110px] flex flex-wrap items-center gap-2.5 bg-[linear-gradient(180deg,rgba(245,246,249,0)_0%,var(--color-background)_22%)] pt-3.5 pb-[62px]">
            {stepIndex > 0 ? (
              <Button type="button" variant="outline" className="h-[42px] px-4" onClick={back}>
                ← Back
              </Button>
            ) : null}
            <div className="flex-1" />
            {isReview ? (
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
                {hint ? (
                  <span
                    className={cn(
                      "text-right text-[13px] font-bold",
                      hint.tone === "fail"
                        ? "text-danger-text"
                        : hint.tone === "warn"
                          ? "text-[#94600A]"
                          : "text-ink-3",
                    )}
                  >
                    {hint.text}
                  </span>
                ) : null}
                <CreateExperimentDialog
                  values={values}
                  website={website}
                  sdkUrl={sdkUrl}
                  verifyAction={verifyAction}
                  activeExperiments={activeExperiments}
                  formId={FORM_ID}
                  isPending={isPending}
                  dialogOpen={dialogOpen}
                  onDialogOpenChange={openReview}
                />
              </div>
            ) : (
              <Button
                type="button"
                className="h-[42px] px-5 font-extrabold"
                onClick={advance}
                disabled={step === "website" && !values.websiteId}
              >
                Continue →
              </Button>
            )}
          </div>
        </div>

        {!isReview ? (
          <WizardRail
            values={values}
            website={website}
            shares={shares}
            className="hidden min-[1180px]:flex"
          />
        ) : null}
      </div>
    </div>
  );
}
