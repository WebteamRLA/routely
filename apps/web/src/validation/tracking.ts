import { z } from "zod";

import { ACCEPTED_PROTOCOL_VERSIONS, LEGACY_PROTOCOL_VERSION } from "@routely/sdk/contract";
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

export const eventBatchSchema = z.object({
  /**
   * Wire protocol version, taken from the contract rather than written out here.
   *
   * A hand-copied number is a version mismatch waiting to happen, and this one is invisible
   * when it breaks: a batch that fails this check is discarded silently by `ingest`, so a stale
   * literal drops every event with no error anywhere. Importing the constant makes a bump
   * update both ends at once.
   *
   * Every accepted version, not only the newest: the batch shape did not change in v4, and an
   * installed v3 bundle (cached in a browser) must keep reporting until it refreshes.
   */
  v: z.literal(ACCEPTED_PROTOCOL_VERSIONS),
  siteId: publicSiteIdSchema,
  visitorId: anonymousIdSchema,
  events: z.array(trackedEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

/**
 * Body of `POST /api/v1/hit` — one site-wide page hit (`PageHit` in the SDK contract).
 *
 * `url` is checked for shape only; the service normalises it again and stores the server's
 * spelling. `ts` is accepted for the contract's sake and clamped — the day a hit counts towards
 * is decided by the server clock, not the browser's.
 */
export const pageHitSchema = z.object({
  v: z.literal(ACCEPTED_PROTOCOL_VERSIONS),
  siteId: publicSiteIdSchema,
  anonymousId: anonymousIdSchema,
  url: absoluteUrlSchema,
  ts: z.number().int().positive(),
});

export type PageHitInput = z.infer<typeof pageHitSchema>;

/**
 * Query parameters of the SDK config endpoint.
 *
 * `v` is the protocol the caller understands. Absent (an installed v3 bundle never sent it) or
 * unparseable reads as 3, the legacy shape — the safe default, since a v3 document omits every
 * experiment an old bundle would mis-serve.
 */
export const configRequestSchema = z.object({
  siteId: publicSiteIdSchema,
  v: z.coerce.number().int().catch(LEGACY_PROTOCOL_VERSION),
});

export type TrackedEventInput = z.infer<typeof trackedEventSchema>;
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
