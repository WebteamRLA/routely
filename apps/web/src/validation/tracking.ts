import { z } from "zod";

import { LEGACY_PROTOCOL_VERSION, SDK_PROTOCOL_VERSION } from "@routely/sdk/contract";
import { EventType } from "@/generated/prisma/enums";
import { absoluteUrlSchema, idSchema, publicSiteIdSchema } from "@/validation/common";

/**
 * Ingestion payload schemas.
 *
 * These describe data arriving from an untrusted browser on a public, unauthenticated
 * endpoint, so every field is bounded: batch size, string lengths, and timestamp range. A
 * payload that fails here is discarded rather than partially applied.
 *
 * `EventType` is derived from the Prisma enum, which uses the same literal strings the SDK
 * sends, so a wire value maps to a column value with no translation step. `variantId` has no
 * equivalent enum to derive from — it's a real id (or `null` for control) checked for shape
 * only; ownership (does it belong to *this* experiment) is verified in the ingestion service,
 * which is the layer that actually has the experiment's variant list to check it against.
 */

export const eventTypeSchema = z.enum(EventType);

/** Opaque visitor identifier minted by the SDK. Format-checked, never trusted as identity. */
export const anonymousIdSchema = z
  .string()
  .trim()
  .min(8, "Invalid visitor id")
  .max(64, "Invalid visitor id")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid visitor id");

/** Upper bound on a single reported foreground interval: 6 hours. */
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/** How far a client clock may deviate before its timestamp is rejected. */
export const MAX_CLOCK_SKEW_PAST_MS = 24 * 60 * 60 * 1000;
export const MAX_CLOCK_SKEW_FUTURE_MS = 5 * 60 * 1000;

/** An experiment-scoped event, as both protocols send it. */
export const trackedEventSchema = z
  .object({
    experimentId: idSchema,
    variantId: idSchema.nullable(),
    type: eventTypeSchema,
    url: absoluteUrlSchema,
    /** Foreground milliseconds; only meaningful on `time_on_page`. */
    durationMs: z.number().int().min(0).max(MAX_DURATION_MS).optional(),
    /** Client clock in epoch milliseconds. Clamped against server time during ingestion. */
    ts: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "time_on_page" && value.durationMs === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "time_on_page events must report a duration",
      });
    }
  });

/** Cap on events per request, so one client cannot force an unbounded transaction. */
export const MAX_EVENTS_PER_BATCH = 50;

/**
 * Custom event keys. Wider than the metric-key rule (`validation/metric.ts`) so a key sent by a
 * tag manager in another casing is still received and simply matches no metric, rather than
 * being indistinguishable from a malformed request.
 */
export const trackKeySchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, "Invalid event key");

/** v4 site-level events: a page view on any page, and `routely.track(key)`. */
export const pageEventSchema = z.object({
  type: z.literal("page"),
  url: absoluteUrlSchema,
  ts: z.number().int().positive(),
});

export const trackEventSchema = z.object({
  type: z.literal("track"),
  key: trackKeySchema,
  url: absoluteUrlSchema,
  ts: z.number().int().positive(),
});

/**
 * v4 experiment events. `conversion` is gone from the browser's vocabulary: conversions are
 * derived server-side from `page` and `track` against assignments already stored, so accepting
 * one here would only reopen a way to claim them.
 */
const experimentEventV4Schema = trackedEventSchema.refine((event) => event.type !== "conversion", {
  message: "Conversions are derived by the server",
});

export const siteEventSchema = z.discriminatedUnion("type", [pageEventSchema, trackEventSchema]);

/**
 * One v4 event: site-level when `type` says so, otherwise experiment-scoped. A union by `type`
 * rather than `discriminatedUnion`, because the experiment branch already carries its own enum.
 */
export const trackedEventV4Schema = z.union([siteEventSchema, experimentEventV4Schema]);

const batchBase = {
  siteId: publicSiteIdSchema,
  visitorId: anonymousIdSchema,
};

/**
 * Wire protocol versions are taken from the contract rather than written out here.
 *
 * A hand-copied number is a version mismatch waiting to happen, and this one is invisible when
 * it breaks: a batch that fails this check is discarded silently by `ingest`, so a stale
 * literal drops every event with no error anywhere.
 */
export const eventBatchV4Schema = z.object({
  v: z.literal(SDK_PROTOCOL_VERSION),
  ...batchBase,
  events: z.array(trackedEventV4Schema).min(1).max(MAX_EVENTS_PER_BATCH),
});

/** v3 bundles — still running from browser caches — send experiment events only. */
export const eventBatchV3Schema = z.object({
  v: z.literal(LEGACY_PROTOCOL_VERSION),
  ...batchBase,
  events: z.array(trackedEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

export const eventBatchSchema = z.discriminatedUnion("v", [eventBatchV4Schema, eventBatchV3Schema]);

/** Query parameters of the SDK config endpoint. */
export const configRequestSchema = z.object({
  siteId: publicSiteIdSchema,
  /** `4` from a v4 bundle; absent (or anything else) from a v3 one, which gets the v3 shape. */
  v: z.string().optional(),
  /** An experiment id from a preview link. */
  preview: idSchema.optional(),
});

export type TrackedEventInput = z.infer<typeof trackedEventSchema>;
export type TrackedEventV4Input = z.infer<typeof trackedEventV4Schema>;
export type SiteEventInput = z.infer<typeof siteEventSchema>;
export type EventBatchInput = z.infer<typeof eventBatchSchema>;

/**
 * Clamps a client timestamp into a trustworthy window. Browser clocks are routinely wrong by
 * hours; accepting them verbatim would scatter events across the time-series charts.
 */
export function clampClientTimestamp(ts: number, now: number = Date.now()): Date {
  const earliest = now - MAX_CLOCK_SKEW_PAST_MS;
  const latest = now + MAX_CLOCK_SKEW_FUTURE_MS;
  return new Date(Math.min(Math.max(ts, earliest), latest));
}
