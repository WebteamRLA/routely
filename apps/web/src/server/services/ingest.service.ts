import "server-only";

import type { EventType } from "@/generated/prisma/client";
import { normalizeUrl, urlMatches } from "@/lib/url";
import { db } from "@/server/db";
import * as assignmentRepo from "@/server/repositories/assignment.repository";
import * as conversionRepo from "@/server/repositories/conversion.repository";
import * as eventRepo from "@/server/repositories/event.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import * as visitorRepo from "@/server/repositories/visitor.repository";
import * as websiteService from "@/server/services/website.service";
import { clampClientTimestamp, eventBatchSchema } from "@/validation/tracking";

/**
 * Ingestion of events reported by the tracking SDK.
 *
 * This is the only write path reachable without a session, so nothing the client sends is
 * trusted as ownership:
 *
 *  - The **website** comes from the public site id, never from a field in the payload.
 *  - Every **experiment** is re-checked against that website. A payload naming an experiment
 *    on someone else's site is discarded, not stored.
 *  - Only **ACTIVE** experiments accept events, so a paused experiment stops recording
 *    immediately even from a browser still holding a cached configuration.
 *  - A claimed **variant id** must actually belong to the experiment it's reported against — a
 *    variant id is a real foreign key now, so unlike the old `"CONTROL" | "VARIANT"` literal, a
 *    forged or stale one could otherwise reference a variant of a *different* experiment and
 *    still satisfy the database's foreign-key constraint while being semantically wrong.
 *  - The **assignment** is read from the database, and the stored arm wins over whatever the
 *    client claims. A cleared cache or a tampered payload cannot move a visitor.
 *  - **URLs are normalised server-side.** The SDK normalises too, but a value that arrives
 *    over the network is an assertion, not a fact.
 *  - **Timestamps are clamped.** Browser clocks are routinely wrong by hours.
 *
 * A batch is processed event by event, and one bad event is dropped rather than failing the
 * request: a beacon cannot retry meaningfully, so partial acceptance loses less than refusal.
 */

/**
 * How close together two identical page views must be to count as one.
 *
 * Repeated SDK initialisation — two copies of the snippet, a tag manager injecting it again,
 * a framework that re-executes scripts on hydration — produces a burst within milliseconds. A
 * person genuinely reloading the same page inside five seconds is rare enough that
 * under-counting them is the better error: a duplicate inflates one arm and biases the
 * comparison, while a missed reload is noise that affects both arms equally.
 */
const PAGE_VIEW_DEDUPE_WINDOW_MS = 5_000;

export interface IngestResult {
  accepted: number;
  rejected: number;
  /** Events discarded as repeats: a duplicate page-view burst, or a repeated conversion. */
  deduplicated: number;
  /**
   * The website these events belong to, resolved from the public site id — null when the batch was
   * malformed or named a site that does not exist.
   *
   * Reported so the route can refresh that website's live Google Sheets tab *after* responding. It
   * is deliberately the id this service resolved rather than anything from the payload: the site id
   * in a request is an assertion, and the website is the fact it resolved to.
   */
  websiteId: string | null;
}

const EMPTY: IngestResult = { accepted: 0, rejected: 0, deduplicated: 0, websiteId: null };

export async function ingest(payload: unknown): Promise<IngestResult> {
  const parsed = eventBatchSchema.safeParse(payload);
  if (!parsed.success) return EMPTY;

  const { siteId, visitorId: anonymousId, events } = parsed.data;

  const website = await websiteService.resolveWebsiteByPublicSiteId(siteId);
  if (!website) {
    return { ...EMPTY, rejected: events.length };
  }

  const now = Date.now();
  const result: IngestResult = {
    accepted: 0,
    rejected: 0,
    deduplicated: 0,
    websiteId: website.id,
  };

  // Experiments are resolved once per batch: a batch usually concerns one experiment, and this
  // keeps a 50-event payload from issuing 50 identical queries.
  const experiments = new Map<
    string,
    Awaited<ReturnType<typeof experimentRepo.findActiveExperimentForWebsite>>
  >();

  // The visitor row is created lazily, only once an event has proved worth storing — otherwise
  // a payload naming nothing but paused experiments would still leave a visitor behind.
  let visitorId: string | null = null;

  for (const event of events) {
    const url = normalizeUrl(event.url);
    if (!url) {
      result.rejected += 1;
      continue;
    }

    if (!experiments.has(event.experimentId)) {
      experiments.set(
        event.experimentId,
        await experimentRepo.findActiveExperimentForWebsite(event.experimentId, website.id),
      );
    }

    const experiment = experiments.get(event.experimentId);

    // Unknown, paused, archived, or belonging to another website — all the same answer.
    if (!experiment) {
      result.rejected += 1;
      continue;
    }

    // A non-null claim must reference one of *this* experiment's own variants. Without this, a
    // crafted payload could name a variant belonging to a completely different experiment —
    // the foreign-key constraint alone would accept it, since it only checks that the id
    // exists somewhere, not that it exists *here*.
    if (
      event.variantId !== null &&
      !experiment.variants.some((variant) => variant.id === event.variantId)
    ) {
      result.rejected += 1;
      continue;
    }

    const occurredAt = clampClientTimestamp(event.ts, now);

    // A conversion must be on the page the experiment actually counts as its goal. Without
    // this the URL is whatever the client says it is, and a crafted payload could book a
    // conversion from anywhere — the one event type where that directly moves the headline
    // number the customer makes decisions on.
    if (
      event.type === "conversion" &&
      !urlMatches(url, experiment.conversionUrl, experiment.conversionMatchType)
    ) {
      result.rejected += 1;
      continue;
    }

    visitorId ??= (await visitorRepo.upsertVisitor(website.id, anonymousId, new Date(now))).id;

    /**
     * A conversion requires an assignment that already exists; every other event type may
     * create one.
     *
     * The difference matters. `assignment` and `page_view` arrive at the moment a visitor is
     * bucketed, so creating the row is the whole point. A conversion arrives later, by which
     * time the assignment has had a full page load to reach the server — so a missing one
     * means either the visitor was never in the experiment, or a forged payload is trying to
     * manufacture one. Creating it here would let a crafted request invent a visitor *and*
     * their arm, and then convert them: a direct way to move an experiment's result.
     */
    const assignment =
      event.type === "conversion"
        ? await assignmentRepo.findAssignment(experiment.id, visitorId)
        : await assignmentRepo.ensureAssignment(
            experiment.id,
            visitorId,
            event.variantId,
            occurredAt,
          );

    if (!assignment) {
      result.rejected += 1;
      continue;
    }

    if (event.type === "page_view" && (await isDuplicatePageView(assignment.id, url, occurredAt))) {
      result.deduplicated += 1;
      continue;
    }

    // A repeat conversion is a no-op, not an error: the unique constraint on `assignmentId`
    // absorbs it, and counting it as rejected would misreport a refresh as a failure.
    if (event.type === "conversion" && (await hasConverted(assignment.id))) {
      result.deduplicated += 1;
      continue;
    }

    await recordEvent({
      websiteId: website.id,
      experimentId: experiment.id,
      visitorId,
      assignmentId: assignment.id,
      // The stored arm, not the reported one.
      variantId: assignment.variantId,
      type: event.type as EventType,
      url,
      durationMs: event.durationMs ?? null,
      occurredAt,
    });

    result.accepted += 1;
  }

  return result;
}

/**
 * True when this assignment already recorded the same page moments ago.
 *
 * Server-side rather than client-side alone, because the client is exactly what cannot be
 * trusted to have run once: the burst this guards against is *caused* by the SDK running more
 * than once. The SDK's own guard prevents the common case cheaply; this one is what makes the
 * count correct.
 */
async function isDuplicatePageView(
  assignmentId: string,
  url: string,
  occurredAt: Date,
): Promise<boolean> {
  const since = new Date(occurredAt.getTime() - PAGE_VIEW_DEDUPE_WINDOW_MS);

  const existing = await db.event.findFirst({
    where: {
      assignmentId,
      type: "page_view",
      url,
      occurredAt: { gte: since, lte: occurredAt },
    },
    select: { id: true },
  });

  return existing !== null;
}

/** True when this assignment has already converted. */
async function hasConverted(assignmentId: string): Promise<boolean> {
  const existing = await conversionRepo.findConversionByAssignment(assignmentId);
  return existing !== null;
}

async function recordEvent(input: {
  websiteId: string;
  experimentId: string;
  visitorId: string;
  assignmentId: string;
  variantId: string | null;
  type: EventType;
  url: string;
  durationMs: number | null;
  occurredAt: Date;
}): Promise<void> {
  // A conversion is also written to its own table, where the unique constraint on
  // assignmentId makes a repeat — a reloaded thank-you page, a duplicate beacon — a no-op.
  if (input.type === "conversion") {
    await conversionRepo.recordConversion({
      experimentId: input.experimentId,
      visitorId: input.visitorId,
      assignmentId: input.assignmentId,
      variantId: input.variantId,
      url: input.url,
      occurredAt: input.occurredAt,
    });
  }

  await eventRepo.createEvents([input], db);
}
