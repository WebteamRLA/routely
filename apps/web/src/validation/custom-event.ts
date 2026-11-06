import { z } from "zod";

import {
  ACCEPTED_PROTOCOL_VERSIONS,
  EVENT_NAME_PATTERN,
  EVENT_PROPERTY_KEY_PATTERN,
  MAX_EVENT_PROPERTIES,
  MAX_EVENT_PROPERTY_LENGTH,
  SENSITIVE_PROPERTY_KEY,
  SENSITIVE_PROPERTY_VALUE,
} from "@routely/sdk/contract";
import { absoluteUrlSchema, idSchema, publicSiteIdSchema } from "@/validation/common";
import { anonymousIdSchema } from "@/validation/tracking";

/**
 * Custom events: what a project configures, and what a browser may send.
 *
 * Configuration is data, never code. A selector is only ever handed to `closest()` and
 * `querySelector()`, which select and cannot execute, and a success event is only an event name.
 * The checks here keep markup and stray control characters out of both.
 */

export const eventNameSchema = z
  .string()
  .trim()
  .regex(
    EVENT_NAME_PATTERN,
    "Use letters, numbers, dots, colons, dashes and underscores, up to 64 characters, starting with a letter or number.",
  );

export const SELECTOR_MAX = 500;

export const selectorSchema = z
  .string()
  .trim()
  .min(1, "Choose an element")
  .max(SELECTOR_MAX, `Keep the selector under ${SELECTOR_MAX} characters`)
  .regex(/^[^<{}\u0000-\u001f]+$/, "That doesn’t look like a CSS selector");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => value || null)
    .nullable()
    .optional();

const urlMatchSchema = z.enum(["EXACT", "PREFIX"]);

export const eventDefinitionSchema = z
  .strictObject({
    websiteId: idSchema,
    name: eventNameSchema,
    description: optionalText(300),
    category: optionalText(60),
    method: z.enum(["CLICK", "FORM", "CODE"]),
    selector: selectorSchema.nullable().optional(),
    pageUrl: absoluteUrlSchema.nullable().optional(),
    /** Null listens on every page. */
    pageMatch: urlMatchSchema.nullable().optional(),
    formSuccess: z.enum(["SUBMIT", "URL", "ELEMENT", "CALLBACK"]).nullable().optional(),
    successUrl: absoluteUrlSchema.nullable().optional(),
    successMatch: urlMatchSchema.optional(),
    successSelector: selectorSchema.nullable().optional(),
    successEvent: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/, "That doesn’t look like an event name")
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    const need = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (value.method === "CLICK" && !value.selector)
      need("selector", "Choose the element to track");
    if (value.pageMatch && !value.pageUrl) need("pageUrl", "Enter the page to limit this to");
    if (value.method !== "FORM") return;

    if (!value.formSuccess) return need("formSuccess", "Choose how a successful submission shows");
    if (value.formSuccess === "SUBMIT" && !value.selector) need("selector", "Choose the form");
    if (value.formSuccess === "URL" && !value.successUrl) {
      need("successUrl", "Enter the page visitors reach after submitting");
    }
    if (value.formSuccess === "ELEMENT") {
      if (!value.selector) need("selector", "Choose the form");
      if (!value.successSelector) need("successSelector", "Enter the success message’s selector");
    }
    if (value.formSuccess === "CALLBACK" && !value.successEvent) {
      need("successEvent", "Choose your form plugin");
    }
  });

export type EventDefinitionInput = z.infer<typeof eventDefinitionSchema>;

/**
 * Keeps only flat, non-sensitive properties. Filtering rather than refusing: one careless property
 * must not lose the event, and what a customer's developer passes is not something a browser can
 * be asked to correct. The SDK applies the same rules first, so this is the check that holds when
 * the browser's is bypassed.
 */
export function filterEventProperties(
  input: unknown,
): Record<string, string | number | boolean> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const kept: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(kept).length >= MAX_EVENT_PROPERTIES) break;
    if (!EVENT_PROPERTY_KEY_PATTERN.test(key) || SENSITIVE_PROPERTY_KEY.test(key)) continue;
    if (typeof value === "string") {
      if (value.length > MAX_EVENT_PROPERTY_LENGTH || SENSITIVE_PROPERTY_VALUE.test(value))
        continue;
      kept[key] = value;
    } else if (
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      kept[key] = value;
    }
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

export const MAX_TRACKED_PER_BATCH = 20;

const customEventPayloadSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().regex(EVENT_NAME_PATTERN),
  url: absoluteUrlSchema,
  ts: z.number().int().positive(),
  props: z.unknown().optional(),
});

const eventIssueSchema = z.object({
  name: z.string().regex(EVENT_NAME_PATTERN),
  code: z.enum(["selector_missing", "selector_ok", "form_ajax"]),
  url: absoluteUrlSchema,
});

/** `POST /api/v1/track`. */
export const trackBatchSchema = z.object({
  v: z.literal(ACCEPTED_PROTOCOL_VERSIONS),
  siteId: publicSiteIdSchema,
  visitorId: anonymousIdSchema,
  events: z.array(customEventPayloadSchema).max(MAX_TRACKED_PER_BATCH).optional(),
  issues: z.array(eventIssueSchema).max(10).optional(),
});

/** `POST /api/v1/verify`. */
export const verifySignalSchema = z.object({
  v: z.literal(ACCEPTED_PROTOCOL_VERSIONS),
  token: z.string().min(16).max(128),
  stage: z.enum(["loaded", "ready", "failed"]),
  reason: z.enum(["config", "no_site_id"]).optional(),
  siteIds: z.array(publicSiteIdSchema).max(10),
  url: absoluteUrlSchema,
  sdk: z.string().max(20).optional(),
});

export const installMethodSchema = z.enum(["MANUAL", "GTM"]);

export const startVerificationSchema = z.strictObject({
  websiteId: idSchema,
  url: absoluteUrlSchema,
  method: installMethodSchema,
});

export const verificationPollSchema = z.strictObject({
  id: idSchema,
  browser: z
    .object({
      stage: z.enum(["loaded", "ready", "failed"]),
      reason: z.enum(["config", "no_site_id"]).optional(),
    })
    .nullable()
    .optional(),
});
