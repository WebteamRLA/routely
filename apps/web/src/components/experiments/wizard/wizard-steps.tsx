"use client";

import { Check, Plus, X } from "lucide-react";

import { AudienceSegments } from "@/components/experiments/wizard/audience-segments";
import { GoalTypes } from "@/components/experiments/wizard/goal-types";
import {
  TrafficDistribution,
  type DistributionArm,
} from "@/components/experiments/traffic-distribution";
import { WizardStepCard } from "@/components/experiments/wizard/wizard-step-card";
import { AddWebsiteDialog, type SheetStepConfig } from "@/components/websites/add-website-dialog";
import type {
  WizardValues,
  WizardVariant,
  WizardWebsite,
} from "@/components/experiments/wizard/wizard-types";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FieldErrors = Record<string, string[]> | undefined;

// ---------------------------------------------------------------------------
// 1. Website
// ---------------------------------------------------------------------------

export function WebsiteStep({
  websites,
  websiteId,
  onSelect,
  onCreate,
  errors,
  onNext,
  sheetStep,
}: {
  websites: WizardWebsite[];
  websiteId: string;
  onSelect: (id: string) => void;
  onCreate: (website: WizardWebsite) => void;
  errors: FieldErrors;
  onNext: () => void;
  /** Offers a Google Sheet for a website added here, exactly as the dashboard does. */
  sheetStep?: SheetStepConfig;
}) {
  return (
    <WizardStepCard
      title="Which website is this for?"
      description="Every URL you set up in the following steps must live on this website's domain."
      onNext={onNext}
      nextDisabled={!websiteId}
    >
      <input type="hidden" name="websiteId" value={websiteId} />

      <div className="grid gap-3 sm:grid-cols-2">
        {websites.map((website) => {
          const selected = website.id === websiteId;
          return (
            <button
              key={website.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(website.id)}
              className={cn(
                "flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border/70 hover:border-primary/50 hover:bg-muted/40",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">{website.name}</span>
                {selected ? <Check className="size-4 text-primary" aria-hidden /> : null}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{website.domain}</span>
            </button>
          );
        })}
      </div>

      <AddWebsiteDialog onCreated={onCreate} sheetStep={sheetStep} />

      {errors?.websiteId?.length ? (
        <p className="text-xs text-destructive">{errors.websiteId.join(" ")}</p>
      ) : null}
    </WizardStepCard>
  );
}

// ---------------------------------------------------------------------------
// 2. Profile
// ---------------------------------------------------------------------------

export function ProfileStep({
  values,
  onChange,
  onVariantUrlChange,
  onAddVariant,
  onRemoveVariant,
  origin,
  errors,
  onNext,
  onBack,
}: {
  values: Pick<WizardValues, "name" | "description" | "controlUrl" | "variants">;
  onChange: <K extends "name" | "description" | "controlUrl">(
    key: K,
    value: WizardValues[K],
  ) => void;
  onVariantUrlChange: (index: number, url: string) => void;
  onAddVariant: () => void;
  onRemoveVariant: (index: number) => void;
  /** Scheme + host, e.g. `https://acme.com` — used for URL placeholders. */
  origin?: string;
  errors: FieldErrors;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <WizardStepCard
      title="Profile"
      description="Name this test, then choose the control page and one or more variants to compare against it."
      onNext={onNext}
      onBack={onBack}
    >
      <Field name="name" label="Experiment name" errors={errors?.name} required>
        {(props) => (
          <Input
            {...props}
            value={values.name}
            onChange={(event) => onChange("name", event.target.value)}
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
        errors={errors?.description}
      >
        {(props) => (
          <Textarea
            {...props}
            value={values.description}
            onChange={(event) => onChange("description", event.target.value)}
            placeholder="Does the rebuilt pricing page convert better than the original?"
            maxLength={500}
            rows={2}
          />
        )}
      </Field>

      <Field
        name="controlUrl"
        label="Control URL"
        hint="The page visitors already land on. They stay here."
        errors={errors?.controlUrl}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={values.controlUrl}
            onChange={(event) => onChange("controlUrl", event.target.value)}
            placeholder={origin ? `${origin}/pricing` : "https://example.com/pricing"}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </Field>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Variants</h3>

        {values.variants.map((variant, index) => (
          <VariantRow
            key={variant.id ?? `new-${index}`}
            index={index}
            variant={variant}
            removable={values.variants.length > 1}
            origin={origin}
            errors={errors?.[`variants.${index}`]}
            onChange={(url) => onVariantUrlChange(index, url)}
            onRemove={() => onRemoveVariant(index)}
          />
        ))}

        <button
          type="button"
          onClick={onAddVariant}
          className="w-full cursor-pointer rounded-lg border border-dashed border-border/70 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="mr-1.5 inline size-3.5" aria-hidden />
          Add URL Variant
        </button>

        {/* Zod collapses every issue under a nested array path (variants.N.url) to the single
         * top-level key "variants", so a validation failure can't be pinned to one row — shown
         * once here instead of a per-row message that would only ever be wrong. */}
        {errors?.variants?.length ? (
          <ul className="space-y-1">
            {errors.variants.map((message) => (
              <li key={message} className="text-xs text-destructive">
                {message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </WizardStepCard>
  );
}

function VariantRow({
  index,
  variant,
  removable,
  origin,
  errors,
  onChange,
  onRemove,
}: {
  index: number;
  variant: WizardVariant;
  removable: boolean;
  /** Scheme + host, e.g. `https://acme.com` — used for URL placeholders. */
  origin?: string;
  /** Blank-field message for this row alone; see `requiredErrors` in the wizard. */
  errors?: string[];
  onChange: (url: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-end gap-2">
      {/* Paired with `variantUrl` by document order — see `readVariants` in the action. */}
      <input type="hidden" name="variantId" value={variant.id ?? ""} />
      <input type="hidden" name="variantWeight" value={variant.weight} />
      <div className="flex-1">
        <Field
          name="variantUrl"
          id={`field-variant-${index}`}
          label={`Variant ${index + 1} URL`}
          hint={index === 0 ? "The alternative page. Visitors are redirected here." : undefined}
          errors={errors}
          required
        >
          {(props) => (
            <Input
              {...props}
              value={variant.url}
              onChange={(event) => onChange(event.target.value)}
              placeholder={
                origin
                  ? `${origin}/pricing-v${index + 1}`
                  : `https://example.com/pricing-v${index + 1}`
              }
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          )}
        </Field>
      </div>

      {removable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`Remove variant ${index + 1}`}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Target audience
// ---------------------------------------------------------------------------

export function AudienceStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <WizardStepCard
      title="Target audience"
      description="Choose who should see your experiment. The share of traffic it takes is set on the Configuration step."
      onNext={onNext}
      onBack={onBack}
    >
      <AudienceSegments />
    </WizardStepCard>
  );
}

// ---------------------------------------------------------------------------
// 4. Metrics setup
// ---------------------------------------------------------------------------

export function MetricsStep({
  conversionUrl,
  conversionMatchType,
  primaryMetric,
  onChangeText,
  origin,
  errors,
  onNext,
  onBack,
}: {
  conversionUrl: string;
  /** Carried for the hidden fields below; there is no control for either on this step. */
  conversionMatchType: WizardValues["conversionMatchType"];
  primaryMetric: WizardValues["primaryMetric"];
  onChangeText: (value: string) => void;
  /** Scheme + host, e.g. `https://acme.com` — used for URL placeholders. */
  origin?: string;
  errors: FieldErrors;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <WizardStepCard
      title="Metrics setup"
      description="Define what counts as a conversion."
      onNext={onNext}
      onBack={onBack}
    >
      <GoalTypes />

      <div className="space-y-5 border-t border-border/70 pt-5">
        <h3 className="text-sm font-medium">Goal page</h3>

        <Field
          name="conversionUrl"
          label="Conversion URL"
          hint="Reaching this page counts as a conversion for whichever version the visitor saw. The snippet must be installed here too."
          errors={errors?.conversionUrl}
          required
        >
          {(props) => (
            <Input
              {...props}
              value={conversionUrl}
              onChange={(event) => onChangeText(event.target.value)}
              placeholder={origin ? `${origin}/thank-you` : "https://example.com/thank-you"}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          )}
        </Field>

        {/*
         * The goal match type and the primary metric no longer have controls on this step, but
         * both are still required by the schema — so they submit from here at their defaults
         * (exact match, conversion rate). Both remain editable on the experiment's own page.
         */}
        <input type="hidden" name="conversionMatchType" value={conversionMatchType} />
        <input type="hidden" name="primaryMetric" value={primaryMetric} />
      </div>
    </WizardStepCard>
  );
}

// ---------------------------------------------------------------------------
// 5. Configuration
// ---------------------------------------------------------------------------

export function ConfigurationStep({
  controlMatchType,
  distribution,
  onChangeDistribution,
  errors,
  onNext,
  onBack,
}: {
  /** Carried for the hidden field below; there is no control for it on this step. */
  controlMatchType: WizardValues["controlMatchType"];
  distribution: { arms: DistributionArm[]; excluded: number };
  onChangeDistribution: (next: { arms: DistributionArm[]; excluded: number }) => void;
  errors: FieldErrors;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <WizardStepCard
      title="Configuration"
      description="How traffic is divided between the arms."
      onNext={onNext}
      onBack={onBack}
    >
      {/* No control for the match type on this step any more, but the schema still requires it,
       * so it submits from here at its default. It stays editable on the experiment's page. */}
      <input type="hidden" name="controlMatchType" value={controlMatchType} />

      <div>
        <TrafficDistribution
          arms={distribution.arms}
          excluded={distribution.excluded}
          onChange={onChangeDistribution}
        />
        {errors?.controlWeight?.length ? (
          <p className="mt-2 text-xs text-destructive">{errors.controlWeight.join(" ")}</p>
        ) : null}
      </div>
    </WizardStepCard>
  );
}
