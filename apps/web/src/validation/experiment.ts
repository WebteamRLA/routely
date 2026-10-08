import { z } from "zod";

import { idSchema } from "@/validation/common";

// -------------------------------------------------------------------------------------------
// The wizard draft (new UI). `ExperimentDraft` in `lib/domain.ts` is the shape; these schemas
// check its *structure* and bounds. Whether a draft is launchable is `lib/validate-draft` plus
// the service's own rules (same-site, conflicts, goal ownership).
// -------------------------------------------------------------------------------------------

export const CHANGE_PROPS = ["text", "bg", "image"] as const;
export const EDITOR_ELEMENTS = ["eyebrow", "headline", "sub", "cta", "trust", "image"] as const;
export const MAX_CHANGES_PER_ARM = 50;

/**
 * One A/B element change. The SDK writes `value` into the customer's page, so the two
 * attribute-shaped props are held to what they claim to be:
 *
 *  - `bg` becomes a CSS background colour — no `;`, braces or angle brackets, so it cannot
 *    smuggle further declarations or markup.
 *  - `image` becomes an `src` — an http(s) URL or a site-relative path, never `javascript:` or
 *    `data:`.
 *
 * `text` is set as text content (never HTML), so it only needs a length bound.
 */
export const changeSchema = z
  .object({
    selector: z
      .string()
      .trim()
      .min(1, "Choose the element to change.")
      .max(500, "Selector is too long"),
    prop: z.enum(CHANGE_PROPS),
    value: z.string().max(5000, "Must be 5000 characters or fewer"),
    el: z.enum(EDITOR_ELEMENTS).optional(),
  })
  .superRefine((change, ctx) => {
    if (change.prop === "bg" && !/^[#a-z0-9(),.%\s-]{1,64}$/i.test(change.value.trim())) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a colour, e.g. #F0603F" });
    }
    if (change.prop === "image") {
      const value = change.value.trim();
      const isPath = value.startsWith("/") && !value.startsWith("//");
      const isHttp = /^https?:\/\//i.test(value);
      if (!isPath && !isHttp) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Use an image URL starting with https:// or /",
        });
      }
    }
  });

/** Lenient form for saving a draft: anything structurally a change is kept as typed. */
const draftChangeSchema = z.object({
  selector: z.string().max(500).default(""),
  prop: z.enum(CHANGE_PROPS),
  value: z.string().max(5000).default(""),
  el: z.enum(EDITOR_ELEMENTS).optional(),
});

const draftArmSchema = z.object({
  id: idSchema.nullish(),
  name: z.string().max(60).optional(),
  url: z.string().trim().max(2048, "Must be 2048 characters or fewer").default(""),
  weight: z.coerce
    .number()
    .int("Must be a whole number")
    .min(0, "Cannot be negative")
    .max(100, "Must be at most 100"),
  changes: z.array(draftChangeSchema).max(MAX_CHANGES_PER_ARM).default([]),
});

/** Structural check of an `ExperimentDraft` — what `saveDraft` accepts. */
export const experimentDraftSchema = z.object({
  id: idSchema.nullish(),
  projectId: idSchema,
  type: z.enum(["redirect", "ab"]),
  name: z.string().trim().max(120, "Must be 120 characters or fewer").default(""),
  url: z.string().trim().max(2048, "Must be 2048 characters or fewer").default(""),
  hypothesis: z.string().trim().max(2000, "Must be 2000 characters or fewer").default(""),
  arms: z
    .array(draftArmSchema)
    .min(1, "At least one arm is required")
    .max(5, "An experiment can have at most 5 arms (Control + 4 variants)."),
  coverage: z.coerce
    .number()
    .int()
    .min(1, "Must be at least 1%")
    .max(100, "Must be at most 100%")
    .default(100),
  /** Parsed tolerantly by `normalizeTargeting` in the service. */
  targeting: z.unknown(),
  goalMode: z.enum(["url", "event"]).default("url"),
  goal: z.string().trim().max(64).default(""),
  convUrl: z.string().trim().max(2048, "Must be 2048 characters or fewer").default(""),
  convMatch: z.enum(["exact", "starts"]).default("exact"),
  secondary: z.array(idSchema).max(20, "At most 20 secondary goals").default([]),
  counting: z.enum(["unique", "all"]).default("unique"),
});

export type ExperimentDraftInput = z.infer<typeof experimentDraftSchema>;

/** Ending an experiment: `winnerPosition` 0 = control, n = variant n, null = no winner. */
export const endExperimentSchema = z.object({
  projectId: idSchema,
  experimentId: idSchema,
  winnerPosition: z.coerce.number().int().min(0).max(4).nullable(),
  keepWinner: z.boolean().default(false),
});

/** Edits allowed while an experiment is running or paused. Everything else is fixed. */
export const editLiveExperimentSchema = z.object({
  projectId: idSchema,
  experimentId: idSchema,
  name: z.string().trim().min(3, "Use at least 3 characters.").max(120).optional(),
  hypothesis: z.string().trim().max(2000).optional(),
  /** Per-arm percentages, control first; must keep the arm count and sum to 100. */
  weights: z.array(z.coerce.number().int().min(0).max(100)).min(2).max(5).optional(),
  coverage: z.coerce.number().int().min(1).max(100).optional(),
  secondary: z.array(idSchema).max(20).optional(),
  counting: z.enum(["unique", "all"]).optional(),
});

export const projectExperimentSchema = z.object({
  projectId: idSchema,
  experimentId: idSchema,
});
