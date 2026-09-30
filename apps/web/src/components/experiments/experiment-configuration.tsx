"use client";

import { Target } from "lucide-react";

import { TrafficDistribution } from "@/components/experiments/traffic-distribution";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import type { PrimaryMetric, UrlMatchType } from "@/generated/prisma/enums";
import { armShares } from "@/lib/traffic";

interface VariantDefault {
  id?: string;
  url: string;
  /** Relative share of the included traffic. See `Experiment.controlWeight` in the schema. */
  weight: number;
}

/**
 * An experiment's configuration, read-only.
 *
 * This was an edit form. It is not one any more: an experiment is configured once, in the creation
 * wizard, and fixed from then on — so there is no action, no submit and nothing editable here.
 *
 * The reasoning is the same one that already froze the URLs, extended to the rest. Visitors are
 * bucketed against the configuration that existed when they arrived, so changing it midway produces
 * one set of results describing two different experiments, with nothing in the numbers marking where
 * one stopped and the other began. Freezing the whole configuration makes that impossible rather
 * than merely discouraged.
 *
 * Shown rather than hidden, because "what is this test actually doing?" is the first question
 * somebody reading results asks. To change any of it, archive the experiment and create a new one.
 */
export function ExperimentConfiguration({
  defaults,
  hasStarted,
}: {
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
  /** True once visitors have been bucketed against this configuration. */
  hasStarted?: boolean;
}) {
  const shares = armShares({
    controlWeight: defaults.controlWeight,
    variantWeights: defaults.variants.map((variant) => variant.weight),
    trafficAllocation: defaults.trafficAllocation,
  });

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <ReadOnlyField label="Experiment name" value={defaults.name} />
        {defaults.description ? (
          <ReadOnlyField label="What are you testing?" value={defaults.description} multiline />
        ) : null}
      </div>

      <div className="space-y-5">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Pages being compared</h3>
          <p className="text-sm text-muted-foreground">
            Visitors on the control URL are split between these, in the shares below.
          </p>
        </div>

        <ReadOnlyField
          label="Control URL"
          value={defaults.controlUrl}
          hint={
            defaults.controlMatchType === "PREFIX"
              ? "This page and anything beneath it"
              : "This exact page"
          }
          mono
        />

        {defaults.variants.map((variant, index) => (
          <ReadOnlyField
            key={variant.id ?? `variant-${index}`}
            label={`Variant ${index + 1} URL`}
            value={variant.url}
            mono
          />
        ))}

        <ReadOnlyField
          label="Conversion URL"
          value={defaults.conversionUrl}
          hint="Reaching this page counts as a conversion for whichever version the visitor saw."
          mono
        />
      </div>

      <div className="space-y-5 border-t border-border/70 pt-5">
        <TrafficDistribution
          arms={[
            { key: null, label: "Control", short: "C", percent: shares.control },
            ...defaults.variants.map((variant, index) => ({
              key: variant.id ?? `new-${index}`,
              label: `Variant ${index + 1}`,
              short: `V${index + 1}`,
              percent: shares.variants[index] ?? 0,
            })),
          ]}
          excluded={shares.excluded}
          // Required by the component, and deliberately inert: nothing here can emit a change.
          onChange={() => {}}
          disabled
        />
      </div>

      {hasStarted ? (
        <Alert>
          <Target aria-hidden />
          <AlertTitle>This experiment is fixed</AlertTitle>
          <AlertDescription>
            Visitors have already been assigned against this configuration, so changing it now would
            mix two different tests into one set of results. Archive it and create a new experiment
            to test something else.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * One configured value, laid out like the field it replaced.
 *
 * A bordered, muted block rather than a disabled `<input>`: a greyed-out input invites clicking and
 * then does nothing, which reads as broken rather than as deliberate. This reads as a value.
 */
function ReadOnlyField({
  label,
  value,
  hint,
  mono = false,
  multiline = false,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground">{label}</Label>
      <p
        className={[
          "rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm",
          mono ? "font-mono break-all" : "",
          multiline ? "whitespace-pre-wrap" : "truncate",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
