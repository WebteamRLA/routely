"use client";

import type * as React from "react";

import { armBg } from "@/components/experiments/arm-colors";
import { TrafficDistribution } from "@/components/experiments/traffic-distribution";
import type { PrimaryMetric, UrlMatchType } from "@/generated/prisma/enums";
import { armShares } from "@/lib/traffic";
import { cn } from "@/lib/utils";

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
 * Laid out as labelled read-only bands, not disabled inputs: a greyed-out input invites clicking
 * and then does nothing, which reads as broken rather than as deliberate.
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

  const versions = [
    {
      key: "control",
      name: "Control",
      share: shares.control,
      url: defaults.controlUrl,
      note:
        defaults.controlMatchType === "PREFIX"
          ? "This page and anything beneath it · visitors stay where they landed"
          : "This exact page · visitors stay where they landed",
    },
    ...defaults.variants.map((variant, index) => ({
      key: variant.id ?? `variant-${index}`,
      name: `Variant ${index + 1}`,
      share: shares.variants[index] ?? 0,
      url: variant.url,
      note: "Visitors are redirected here instead",
    })),
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {defaults.description ? (
        <Section label="What are you testing?">
          <p className="text-sm whitespace-pre-wrap italic">{defaults.description}</p>
        </Section>
      ) : null}

      <Section label="Versions">
        <ul className="flex flex-col gap-3">
          {versions.map((version, index) => (
            <li key={version.key} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", armBg(index))} />
              <span className="min-w-[78px] font-extrabold">{version.name}</span>
              <span className="min-w-[42px] font-bold tabular-nums">{version.share}%</span>
              <span className="min-w-0 flex-[1_1_200px]">
                <span className="block font-mono text-[13px] break-all">{version.url}</span>
                <span className="block text-xs text-ink-3">{version.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4 border-b border-divider px-5 py-4">
        <div className="min-w-0">
          <SectionLabel>Goal</SectionLabel>
          <p className="mt-1 font-mono text-[13px] break-all">{defaults.conversionUrl}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {defaults.conversionMatchType === "PREFIX"
              ? "This page and beneath it"
              : "This exact page"}{" "}
            · reaching it counts as a conversion for whichever version the visitor saw.
          </p>
        </div>
        <div className="min-w-0">
          <SectionLabel>Traffic</SectionLabel>
          <p className="mt-1 text-[13.5px]">
            {defaults.trafficAllocation}% of visitors on the control page are included
            {defaults.trafficAllocation < 100
              ? `; ${shares.excluded}% are left out`
              : " (everyone)"}
            .
          </p>
        </div>
        <div className="min-w-0">
          <SectionLabel>Results judged on</SectionLabel>
          <p className="mt-1 text-[13.5px] font-bold">{METRIC_LABEL[defaults.primaryMetric]}</p>
        </div>
      </div>

      <div className="px-5 py-4">
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
        <div className="border-t border-divider px-5 py-4">
          <div className="rounded-lg bg-brand-tint-2 px-4 py-3 text-[13.5px] font-semibold text-[#1F3FB0]">
            This experiment is fixed. Visitors have already been assigned against this
            configuration, so changing it now would mix two different tests into one set of results.
            Archive it and create a new experiment to test something else.
          </div>
        </div>
      ) : null}
    </div>
  );
}

const METRIC_LABEL: Record<PrimaryMetric, string> = {
  CONVERSION_RATE: "Conversion rate",
  TIME_ON_PAGE: "Average time on page (approximate)",
  PAGE_VIEWS: "Page views per visitor",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-extrabold tracking-[0.06em] text-ink-3 uppercase">{children}</p>
  );
}

/** One labelled band of the configuration, divided from the next by a hairline. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-divider px-5 py-4">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2">{children}</div>
    </div>
  );
}
