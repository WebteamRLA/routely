import { z } from "zod";

import { absoluteUrlSchema, idSchema } from "@/validation/common";

/**
 * Project metrics: custom events (`routely.track(key)`) and page visits.
 *
 * Messages follow the prototype's metric modal. Rules that need the project's other metrics or
 * its domains (unique name/key, same-site page URL) are enforced in `metric.service`.
 */

/** Event keys are what customers type into `routely.track('…')` and GTM — keep them boring. */
export const METRIC_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const metricKindSchema = z
  .enum(["event", "page", "CUSTOM_EVENT", "PAGE_VISIT"])
  .transform((kind) => (kind === "page" || kind === "PAGE_VISIT" ? "PAGE_VISIT" : "CUSTOM_EVENT"));

const matchSchema = z
  .enum(["exact", "starts", "EXACT", "PREFIX"])
  .default("exact")
  .transform((match) => (match === "starts" || match === "PREFIX" ? "PREFIX" : "EXACT"));

export const createMetricSchema = z
  .object({
    projectId: idSchema,
    name: z
      .string({ error: "Name is required." })
      .trim()
      .min(1, "Name is required.")
      .max(80, "Must be 80 characters or fewer"),
    kind: metricKindSchema,
    key: z.string().trim().max(64, "Must be 64 characters or fewer").optional(),
    url: z.string().trim().max(2048).optional(),
    matchType: matchSchema,
  })
  .superRefine((value, ctx) => {
    if (value.kind === "CUSTOM_EVENT") {
      const key = value.key ?? "";
      if (!key) {
        ctx.addIssue({ code: "custom", path: ["key"], message: "Event name is required." });
      } else if (!METRIC_KEY_RE.test(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["key"],
          message: "Use lowercase letters, numbers and underscores, e.g. demo_booked",
        });
      }
      return;
    }

    const url = value.url ?? "";
    if (!url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Enter the URL that counts as a conversion.",
      });
    } else if (!absoluteUrlSchema.safeParse(url).success) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Use a full URL, e.g. https://example.com/thank-you",
      });
    }
  });

export const deleteMetricSchema = z.object({
  projectId: idSchema,
  metricId: idSchema,
});

/** The key a page-visit metric gets: `page_view_` + a slug of its name (prototype rule). */
export function pageVisitKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `page_view_${slug || "page"}`.slice(0, 64);
}

export type CreateMetricInput = z.infer<typeof createMetricSchema>;
