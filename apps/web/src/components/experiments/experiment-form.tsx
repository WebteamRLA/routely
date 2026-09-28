"use client";

import { Fragment, useActionState, useState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import Link from "next/link";
import { Plus, Target, X } from "lucide-react";

import { Field } from "@/components/common/field";
import { SubmitButton } from "@/components/common/submit-button";
import {
  TrafficDistribution,
  type DistributionArm,
} from "@/components/experiments/traffic-distribution";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PrimaryMetric, UrlMatchType } from "@/generated/prisma/enums";
import { IDLE, type FormState } from "@/lib/form-state";
import { armShares } from "@/lib/traffic";

interface VariantDefault {
  id?: string;
  url: string;
  /** Relative share of the included traffic. See `Experiment.controlWeight` in the schema. */
  weight: number;
}

/**
 * Edit form for an existing redirect experiment.
 *
 * Creation has its own multi-step wizard (`components/experiments/wizard`); this form only
 * ever edits a experiment already attached to a website, so there is no website switcher here —
 * the website is fixed and shown as context on the page around this form instead.
 *
 * Validation errors come back from the server through `useActionState` rather than being
 * duplicated client-side — the server's rules are the only definition of what is valid, and
 * two of them (the same-site rule and the active-conflict rule) need data the browser does not
 * have.
 */
export function ExperimentForm({
  action,
  experimentId,
  defaults,
  urlsLocked = false,
  submitLabel,
  pendingLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  experimentId: string;
  defaults: {
    name: string;
    description?: string;
    controlUrl: string;
    controlMatchType: UrlMatchType;
    controlWeight: number;
    variants: VariantDefault[];
    conversionUrl: string;
    conversionMatchType: UrlMatchType;
    primaryMetric: PrimaryMetric;
    trafficAllocation: number;
  };
  /** True once the experiment has started: its targets are fixed from then on. */
  urlsLocked?: boolean;
  submitLabel: string;
  pendingLabel: string;
  cancelHref?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  useFormToast(state);
  const [controlMatchType, setControlMatchType] = useState(defaults.controlMatchType);
  // Neither has a control on this form any more, so neither can change while it is open —
  // they are carried straight through to their hidden fields so an update cannot blank them.
  // The goal's match type stays editable on its Metrics page; the primary metric is fixed at
  // whatever the experiment was created with.
  const conversionMatchType = defaults.conversionMatchType;
  const primaryMetric = defaults.primaryMetric;
  const [trafficAllocation, setTrafficAllocation] = useState(defaults.trafficAllocation);
  const [controlWeight, setControlWeight] = useState(defaults.controlWeight);
  const [variants, setVariants] = useState(defaults.variants);

  function setVariantUrl(index: number, url: string) {
    setVariants((previous) =>
      previous.map((variant, i) => (i === index ? { ...variant, url } : variant)),
    );
  }

  function addVariant() {
    // A new arm joins on the same footing as control rather than inheriting a weight that
    // would silently favour it.
    setVariants((previous) => [...previous, { url: "", weight: controlWeight }]);
  }

  function removeVariant(index: number) {
    setVariants((previous) =>
      previous.length > 1 ? previous.filter((_, i) => i !== index) : previous,
    );
  }

  const shares = armShares({
    controlWeight,
    variantWeights: variants.map((variant) => variant.weight),
    trafficAllocation,
  });

  /** See the matching handler in the wizard — the editor speaks percentages of total traffic,
   * storage keeps relative weights plus a separate allocation. */
  function applyDistribution(next: { arms: DistributionArm[]; excluded: number }) {
    const [control, ...variantPercents] = next.arms.map((arm) => arm.percent);
    const anyWeight = next.arms.some((arm) => arm.percent > 0);

    if (anyWeight) {
      setControlWeight(control ?? 0);
      setVariants((previous) =>
        previous.map((variant, index) => ({ ...variant, weight: variantPercents[index] ?? 0 })),
      );
    }
    setTrafficAllocation(Math.max(1, 100 - next.excluded));
  }

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="experimentId" value={experimentId} />
      <input type="hidden" name="controlMatchType" value={controlMatchType} />
      <input type="hidden" name="conversionMatchType" value={conversionMatchType} />
      <input type="hidden" name="primaryMetric" value={primaryMetric} />
      <input type="hidden" name="controlWeight" value={controlWeight} />

      <div className="space-y-5">
        <Field
          name="name"
          label="Experiment name"
          hint="Only used to identify this test inside Routely."
          errors={state.fieldErrors?.["name"]}
        >
          {(props) => (
            <Input
              {...props}
              defaultValue={defaults.name}
              placeholder="Pricing page redesign"
              maxLength={120}
              autoComplete="off"
              required
            />
          )}
        </Field>

        <Field
          name="description"
          label="What are you testing?"
          hint="Optional. A sentence now saves guesswork when you read the results later."
          errors={state.fieldErrors?.["description"]}
        >
          {(props) => (
            <Textarea
              {...props}
              defaultValue={defaults.description}
              placeholder="Does the rebuilt pricing page convert better than the original?"
              maxLength={500}
              rows={2}
            />
          )}
        </Field>
      </div>

      <fieldset disabled={urlsLocked} className="space-y-5 disabled:opacity-60">
        <legend className="sr-only">Pages to compare</legend>

        <div className="space-y-1">
          <h3 className="text-sm font-medium">Pages to compare</h3>
          <p className="text-sm text-muted-foreground">
            Each arm&rsquo;s share of traffic is set under Traffic Distribution below.
          </p>
        </div>

        <Field
          name="controlUrl"
          label="Control URL"
          hint="The page visitors already land on. They stay here."
          errors={state.fieldErrors?.["controlUrl"]}
        >
          {(props) => (
            <Input
              {...props}
              defaultValue={defaults.controlUrl}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          )}
        </Field>

        <div className="space-y-2">
          <Label htmlFor="edit-control-match">Control URL match type</Label>
          <Select
            value={controlMatchType}
            onValueChange={(value) => setControlMatchType(value as UrlMatchType)}
            disabled={urlsLocked}
          >
            <SelectTrigger id="edit-control-match" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EXACT">Exact page</SelectItem>
              <SelectItem value="PREFIX">This page and anything beneath it</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium">Variants</h4>

          {variants.map((variant, index) => (
            <div key={variant.id ?? `new-${index}`} className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  name="variantUrl"
                  id={`edit-variant-${index}`}
                  label={`Variant ${index + 1} URL`}
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={variant.url}
                      onChange={(event) => setVariantUrl(index, event.target.value)}
                      inputMode="url"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                    />
                  )}
                </Field>
              </div>

              {variants.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeVariant(index)}
                  aria-label={`Remove variant ${index + 1}`}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            onClick={addVariant}
            className="w-full cursor-pointer rounded-lg border border-dashed border-border/70 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus className="mr-1.5 inline size-3.5" aria-hidden />
            Add URL Variant
          </button>

          {/* Zod collapses every issue under a nested array path (variants.N.url) to the
           * single top-level key "variants", so a validation failure can't be pinned to one
           * row — shown once here instead of a per-row message that would only ever be wrong. */}
          {state.fieldErrors?.["variants"]?.length ? (
            <ul className="space-y-1">
              {state.fieldErrors["variants"].map((message) => (
                <li key={message} className="text-xs text-destructive">
                  {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <Field
          name="conversionUrl"
          label="Conversion URL"
          hint="Reaching this page counts as a conversion for whichever version the visitor saw. The snippet must be installed here too."
          errors={state.fieldErrors?.["conversionUrl"]}
        >
          {(props) => (
            <Input
              {...props}
              defaultValue={defaults.conversionUrl}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          )}
        </Field>
      </fieldset>

      {/*
       * Outside the fieldset on purpose. **A disabled fieldset submits none of its controls**,
       * and the one above is disabled once an experiment has started — so anything a running
       * experiment still needs to send has to live out here.
       *
       * Weights belong here permanently: re-weighting is explicitly allowed while a test runs
       * (see `updateExperiment`), and it was impossible before, because `variantWeight` sat
       * inside the locked block and never reached the server.
       *
       * The URLs are mirrored only while locked, where they cannot have changed. That keeps
       * the payload complete without letting a hidden field become a second, editable copy of
       * a visible one.
       */}
      {variants.map((variant, index) => (
        <Fragment key={`weight-${variant.id ?? index}`}>
          {/* Paired with `variantUrl` by document order — see `readVariants` in the action. */}
          <input type="hidden" name="variantId" value={variant.id ?? ""} />
          <input type="hidden" name="variantWeight" value={variant.weight} />
          {urlsLocked ? <input type="hidden" name="variantUrl" value={variant.url} /> : null}
        </Fragment>
      ))}
      {urlsLocked ? (
        <>
          <input type="hidden" name="controlUrl" value={defaults.controlUrl} />
          <input type="hidden" name="conversionUrl" value={defaults.conversionUrl} />
        </>
      ) : null}

      <div className="space-y-5 border-t border-border/70 pt-5">
        <input type="hidden" name="trafficAllocation" value={trafficAllocation} />
        <TrafficDistribution
          arms={[
            { key: null, label: "Control", short: "C", percent: shares.control },
            ...variants.map((variant, index) => ({
              key: variant.id ?? `new-${index}`,
              label: `Variant ${index + 1}`,
              short: `V${index + 1}`,
              percent: shares.variants[index] ?? 0,
            })),
          ]}
          excluded={shares.excluded}
          onChange={applyDistribution}
        />
        {state.fieldErrors?.["controlWeight"]?.length ? (
          <p className="text-xs text-destructive">{state.fieldErrors["controlWeight"].join(" ")}</p>
        ) : null}
      </div>

      {urlsLocked ? (
        <Alert>
          <Target aria-hidden />
          <AlertTitle>This experiment has already started</AlertTitle>
          <AlertDescription>
            Its URLs are fixed. Visitors are already assigned against the current configuration, so
            changing the pages now would mix two different tests into one set of results. Archive it
            and create a new experiment to test different pages.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
        {cancelHref ? (
          <Button variant="ghost" asChild>
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
