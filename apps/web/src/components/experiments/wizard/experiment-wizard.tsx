"use client";

import { useActionState, useState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";

import {
  AudienceStep,
  ConfigurationStep,
  MetricsStep,
  ProfileStep,
  WebsiteStep,
} from "@/components/experiments/wizard/wizard-steps";
import type { DistributionArm } from "@/components/experiments/traffic-distribution";
import { WizardStepper } from "@/components/experiments/wizard/wizard-stepper";
import { SummaryStep } from "@/components/experiments/wizard/wizard-summary";
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
import { IDLE, type FormState } from "@/lib/form-state";
import { siteOrigin } from "@/lib/site-url";
import { armShares } from "@/lib/traffic";

type StepKey = "website" | "profile" | "audience" | "metrics" | "configuration" | "summary";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "website", label: "Website" },
  { key: "profile", label: "Profile" },
  { key: "audience", label: "Target audience" },
  { key: "metrics", label: "Metrics setup" },
  { key: "configuration", label: "Configuration" },
  { key: "summary", label: "Summary" },
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

/**
 * The multi-step experiment creation flow.
 *
 * Every step's fields live in **one** real `<form>` for the whole wizard — a step that isn't
 * current is hidden with the `hidden` attribute, not unmounted, so its inputs still submit
 * along with everything else when the summary step's dialog confirms. State is still lifted to
 * React (rather than left fully uncontrolled) because the summary step's pre-publish check
 * needs to read live values as the customer types, not just at submit time.
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
  /** Passed through to the summary, whose install check can open the pixel setup guide. */
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
   * The distribution editor works in percentages of total traffic; storage keeps relative
   * weights plus a separate allocation. Because the weights are relative, the percentages can
   * be stored verbatim — see `lib/traffic.ts` for why that round trip is exact.
   */
  function applyDistribution(next: { arms: DistributionArm[]; excluded: number }) {
    const [control, ...variantPercents] = next.arms.map((arm) => arm.percent);
    const anyWeight = next.arms.some((arm) => arm.percent > 0);

    setValues((previous) => ({
      ...previous,
      // A distribution with nothing left for the arms cannot be drawn from, so the previous
      // weights are kept rather than writing an unusable all-zero set.
      controlWeight: anyWeight ? (control ?? 0) : previous.controlWeight,
      variants: previous.variants.map((variant, index) => ({
        ...variant,
        weight: anyWeight ? (variantPercents[index] ?? 0) : variant.weight,
      })),
      // trafficAllocation has a floor of 1: excluding literally everyone is an experiment that
      // can never record anything.
      trafficAllocation: Math.max(1, 100 - next.excluded),
    }));
  }

  const stepIndex = STEPS.findIndex((item) => item.key === step);

  // A field error on a step other than the one showing means the customer submitted from the
  // summary step's dialog with a mistake made several steps earlier — jump back to it rather
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
   * all the way to Summary and only then be told.
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
   * Opening the review dialog is the last gate before submission, so it is where a blank
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

  const distribution = {
    arms: [
      { key: null, label: "Control", short: "C", percent: shares.control },
      ...values.variants.map((variant, index) => ({
        key: variant.id ?? `new-${index}`,
        label: `Variant ${index + 1}`,
        short: `V${index + 1}`,
        percent: shares.variants[index] ?? 0,
      })),
    ],
    excluded: shares.excluded,
  };

  // The client's blank-field messages take precedence: they describe what is on screen right
  // now, whereas a server error refers to the payload of an earlier submit.
  const fieldErrors: FieldErrors = { ...state.fieldErrors, ...clientErrors };

  const stepper = (
    <WizardStepper
      steps={STEPS}
      currentIndex={stepIndex}
      maxIndex={maxStepIndex}
      onSelect={(key) => goTo(key as StepKey)}
    />
  );

  return (
    <div className="space-y-6">
      {/*
       * The steps are a section of the page. They were previously published into the app's top
       * bar through a `NavbarSlot` store, which existed only because an App Router layout
       * cannot receive anything from the page inside it. With the bar gone the indirection has
       * nothing left to bridge, so the stepper simply renders where it belongs — above the
       * thing it describes, at the width of the content it belongs to.
       */}
      <div className="rounded-xl border border-border bg-card px-4 py-3">{stepper}</div>

      <form id={FORM_ID} action={formAction} className="space-y-6">
        {/* Lives at form level rather than inside the configuration step: it is a single value
         * with no field of its own, and the step that edits it is often not the visible one. */}
        <input type="hidden" name="controlWeight" value={values.controlWeight} />
        {/* Edited on the Configuration step as the "Excluded" share, which has no field of its
         * own — so the value needs carrying into the submission explicitly. */}
        <input type="hidden" name="trafficAllocation" value={values.trafficAllocation} />

        <div hidden={step !== "website"}>
          <WebsiteStep
            websites={websiteList}
            websiteId={values.websiteId}
            onSelect={(id) => set("websiteId", id)}
            onCreate={handleWebsiteCreated}
            errors={fieldErrors}
            onNext={advance}
          />
        </div>

        <div hidden={step !== "profile"}>
          <ProfileStep
            values={values}
            onChange={set}
            onVariantUrlChange={setVariantUrl}
            onRemoveVariant={removeVariant}
            origin={origin}
            errors={fieldErrors}
            onNext={advance}
            onBack={back}
          />
        </div>

        <div hidden={step !== "audience"}>
          <AudienceStep onNext={advance} onBack={back} />
        </div>

        <div hidden={step !== "metrics"}>
          <MetricsStep
            conversionUrl={values.conversionUrl}
            conversionMatchType={values.conversionMatchType}
            primaryMetric={values.primaryMetric}
            onChangeText={(value) => set("conversionUrl", value)}
            origin={origin}
            errors={fieldErrors}
            onNext={advance}
            onBack={back}
          />
        </div>

        <div hidden={step !== "configuration"}>
          <ConfigurationStep
            controlMatchType={values.controlMatchType}
            distribution={distribution}
            onChangeDistribution={applyDistribution}
            errors={fieldErrors}
            onNext={advance}
            onBack={back}
          />
        </div>

        <div hidden={step !== "summary"}>
          <SummaryStep
            values={values}
            website={website}
            sdkUrl={sdkUrl}
            verifyAction={verifyAction}
            activeExperiments={activeExperiments}
            formId={FORM_ID}
            isPending={isPending}
            dialogOpen={dialogOpen}
            onDialogOpenChange={openReview}
            onBack={back}
          />
        </div>
      </form>
    </div>
  );
}
