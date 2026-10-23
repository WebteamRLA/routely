import { z } from "zod";

import {
  DeviceType,
  ExperimentStatus,
  ExperimentType,
  PrimaryMetric,
  UrlMatchType,
} from "@/generated/prisma/enums";
import { MAX_VARIANTS, NAME_MAX, URL_MAX } from "@/lib/launch-rules";
import { isSameUrl } from "@/lib/url";
import {
  absoluteUrlSchema,
  displayNameSchema,
  idSchema,
  trafficAllocationSchema,
} from "@/validation/common";
import { visualChangesSchema } from "@/validation/visual-change";

export const urlMatchTypeSchema = z.enum(UrlMatchType);
export const experimentStatusSchema = z.enum(ExperimentStatus);
export const experimentTypeSchema = z.enum(ExperimentType);
export const deviceTypeSchema = z.enum(DeviceType);
export const primaryMetricSchema = z.enum(PrimaryMetric);

/**
 * An arm's share of the traffic entered into the experiment, relative to the other arms.
 * `0` is allowed — it parks an arm without deleting it — but the schema rejects a set where
 * *every* arm is 0, since that leaves no arm to draw and nothing to divide by.
 */
export const armWeightSchema = z
  .number()
  .int("Must be a whole number")
  .min(0, "Cannot be negative")
  .max(100, "Must be at most 100");

/** One redirect target. `id` is present when editing an existing variant, absent for a new
 * one — that's what lets the service tell "update this row" from "create this row" apart. */
export const experimentVariantSchema = z.object({
  id: idSchema.optional(),
  url: absoluteUrlSchema,
  weight: armWeightSchema.default(50),
});

const experimentFields = z.object({
  websiteId: idSchema,
  name: displayNameSchema,
  description: z.string().trim().max(500, "Must be 500 characters or fewer").optional(),

  controlUrl: absoluteUrlSchema,
  controlMatchType: urlMatchTypeSchema.default("EXACT"),
  controlWeight: armWeightSchema.default(50),
  variants: z.array(experimentVariantSchema).min(1, "At least one variant is required"),

  /** Label for the goal. Optional — the UI falls back to the experiment's name. */
  conversionName: z.string().trim().max(120, "Must be 120 characters or fewer").optional(),
  conversionUrl: absoluteUrlSchema,
  conversionMatchType: urlMatchTypeSchema.default("EXACT"),
  primaryMetric: primaryMetricSchema.default("CONVERSION_RATE"),

  trafficAllocation: trafficAllocationSchema.default(100),
});

/**
 * Cross-field rules that prevent an experiment from being unable to produce a meaningful
 * result. Each of these is a configuration mistake that looks fine field-by-field:
 *
 *  - control === a variant would redirect a visitor to the page they are already on, which the
 *    SDK's loop guard would suppress, silently starving that arm.
 *  - two variants sharing a URL is the same mistake between two arms instead of one — a
 *    duplicate redirect target that can never be told apart in results.
 *  - conversion === control converts every control visitor on arrival, pinning that arm at
 *    100% and making the comparison meaningless.
 *  - conversion === a variant does the same to that arm.
 */
function applyUrlRules<
  T extends z.ZodType<{
    controlUrl: string;
    controlWeight: number;
    variants: { url: string; weight: number }[];
    conversionUrl: string;
  }>,
>(schema: T) {
  return schema.superRefine((value, ctx) => {
    // Every arm parked at 0 leaves no arm to draw and nothing to normalise against — the one
    // weight combination that cannot produce an experiment at all.
    const totalWeight =
      value.controlWeight + value.variants.reduce((sum, variant) => sum + variant.weight, 0);
    if (totalWeight <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["controlWeight"],
        message: "At least one arm must receive some traffic",
      });
    }

    value.variants.forEach((variant, index) => {
      if (isSameUrl(value.controlUrl, variant.url)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "url"],
          message: "A variant URL must be different from the control URL",
        });
      }

      if (isSameUrl(value.conversionUrl, variant.url)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "url"],
          message: "A variant URL must be different from the conversion URL",
        });
      }

      const duplicateAt = value.variants.findIndex(
        (other, otherIndex) => otherIndex < index && isSameUrl(other.url, variant.url),
      );
      if (duplicateAt !== -1) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "url"],
          message: "Two variants can't point at the same URL",
        });
      }
    });

    if (isSameUrl(value.conversionUrl, value.controlUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["conversionUrl"],
        message: "The conversion URL must be different from the control URL",
      });
    }
  });
}

export const createExperimentSchema = applyUrlRules(experimentFields);

/**
 * Updates carry every URL field so the cross-field rules can be re-evaluated against the
 * complete result; the caller merges the stored experiment with the user's changes first.
 */
export const updateExperimentSchema = applyUrlRules(
  experimentFields.omit({ websiteId: true }).extend({ experimentId: idSchema }),
);

export const experimentIdSchema = z.object({
  experimentId: idSchema,
});

export const changeExperimentStatusSchema = z.object({
  experimentId: idSchema,
  status: experimentStatusSchema,
});

export type ExperimentVariantInput = z.infer<typeof experimentVariantSchema>;
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;
export type UpdateExperimentInput = z.infer<typeof updateExperimentSchema>;
export type ChangeExperimentStatusInput = z.infer<typeof changeExperimentStatusSchema>;

// ---------------------------------------------------------------------------------------------
// The new-design wizards: lenient drafts, a strict launch, and the paused-edit limits.
//
// A draft is saved as the customer types (spec §3.6), so its schema rejects only shape and caps —
// a name up to 120 characters, URLs up to 2,048, at most four variants — and stores everything
// else as it stands: an empty name, a half-typed URL, a split that adds up to 90. Whether the
// result can go live is decided at launch by `lib/launch-rules.ts` (`setupIssues`, the design's
// verbatim messages) plus the database rules in `experiment.service`.
// ---------------------------------------------------------------------------------------------

const draftNameSchema = z.string().max(NAME_MAX, `Use ${NAME_MAX} characters or fewer.`);
const draftUrlSchema = z.string().max(URL_MAX, `Use a URL of ${URL_MAX} characters or fewer.`);
/** A typed percentage. Three digits is all the inputs accept; launch requires the real range. */
const draftPercentSchema = z.number().int("Must be a whole number").min(0).max(999);

/**
 * One variant row as the wizard holds it. `key` is the wizard's own id for the row, echoed back
 * with the stored id so a row added in the browser can be matched to the row created for it.
 * `id` names an existing variant — the service only accepts ids of this experiment's variants.
 */
export const draftVariantSchema = z.strictObject({
  id: idSchema.optional(),
  key: z.string().trim().min(1).max(64),
  name: draftNameSchema,
  /** SPLIT_URL only; ignored for an A/B test. */
  url: draftUrlSchema.nullable().optional(),
  weight: draftPercentSchema,
  colorIndex: z.number().int().min(1).max(MAX_VARIANTS).optional(),
  /** AB_TEST only; ignored for a Split URL test. Replaces the variant's whole change set. */
  changes: visualChangesSchema.optional(),
});

/** Any subset of a draft's fields. Absent = unchanged. */
export const draftPatchSchema = z.strictObject({
  name: draftNameSchema.optional(),
  controlUrl: draftUrlSchema.nullable().optional(),
  conversionUrl: draftUrlSchema.nullable().optional(),
  keepQueryParams: z.boolean().optional(),
  trafficAllocation: draftPercentSchema.optional(),
  controlWeight: draftPercentSchema.optional(),
  /** Empty = every device; the service normalises all three to empty. */
  targetDevices: z.array(deviceTypeSchema).max(3).optional(),
  wizardStep: z.number().int().min(1).max(5).optional(),
  /** The complete variant list, in display order: rows left out are deleted. */
  variants: z
    .array(draftVariantSchema)
    .min(1, "Keep at least one variant.")
    .max(MAX_VARIANTS, `Add up to ${MAX_VARIANTS} variants.`)
    .optional(),
});

export const createDraftSchema = z.object({
  type: experimentTypeSchema,
  websiteId: idSchema,
});

/**
 * What may change once an experiment has started (D7): the name and the share of visitors
 * included. URLs, arms, changes, devices, goal and weights stay as launched — visitors are
 * already bucketed against them.
 */
export const PAUSED_EDIT_LOCKED_MESSAGE =
  "Only the name and the traffic included can change once an experiment has started.";

export const pausedEditSchema = z.strictObject(
  {
    name: z
      .string()
      .trim()
      .min(1, "Give your experiment a name.")
      .max(NAME_MAX, `Use ${NAME_MAX} characters or fewer.`)
      .optional(),
    trafficAllocation: z
      .number("Enter a percentage between 1 and 100.")
      .int("Enter a percentage between 1 and 100.")
      .min(1, "Enter a percentage between 1 and 100.")
      .max(100, "Enter a percentage between 1 and 100.")
      .optional(),
  },
  {
    error: (issue) => (issue.code === "unrecognized_keys" ? PAUSED_EDIT_LOCKED_MESSAGE : undefined),
  },
);

export type DraftPatch = z.infer<typeof draftPatchSchema>;
export type DraftVariantInput = z.infer<typeof draftVariantSchema>;
export type PausedEdit = z.infer<typeof pausedEditSchema>;
