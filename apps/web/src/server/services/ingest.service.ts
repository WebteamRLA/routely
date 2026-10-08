import "server-only";

import type { EventType } from "@/generated/prisma/client";
import { type MetricDef, type SiteEvent, goalsMet, metricsHit } from "@/lib/goal-match";
import { URL_GOAL_KEY } from "@/lib/goal-match";
import { normalizeUrl, urlMatches } from "@/lib/url";
import { db } from "@/server/db";
import * as assignmentRepo from "@/server/repositories/assignment.repository";
import * as configRepo from "@/server/repositories/config.repository";
import * as conversionRepo from "@/server/repositories/conversion.repository";
import * as eventRepo from "@/server/repositories/event.repository";
import * as visitorRepo from "@/server/repositories/visitor.repository";
import * as websiteService from "@/server/services/website.service";
import {
  type SiteEventInput,
  type TrackedEventInput,
  clampClientTimestamp,
  eventBatchSchema,
} from "@/validation/tracking";

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
 * Two protocols are accepted. v3 bundles (still in browser caches) send experiment events
 * including `conversion`, checked against the URL goal as before. v4 bundles never send a
 * conversion: they send `page` (every page view) and `track` (custom events), and conversions
 * are **derived** here — for each of the visitor's *existing* assignments in running
 * experiments whose primary or secondary goal the event meets. The same events record a
 * `MetricHit` for every project metric they match.
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
 *
 * The same window de-duplicates conversion *events* (counting mode ALL) per goal.
 */
const DEDUPE_WINDOW_MS = 5_000;

export interface IngestResult {
  /** Experiment events stored, plus site events that produced at least one conversion. */
  accepted: number;
  rejected: number;
  /** Events discarded as repeats: a duplicate page-view burst, or a repeated conversion. */
  deduplicated: number;
  /** `MetricHit` rows written. */
  metricHits: number;
  /** Conversions recorded for the first time (unique per assignment and goal). */
  conversions: number;
  /**
   * The website these events belong to, resolved from the public site id — null when the batch was
   * malformed or named a site that does not exist. Reported so the route can refresh that
   * website's live Google Sheets tab *after* responding.
   */
  websiteId: string | null;
}

const EMPTY: IngestResult = {
  accepted: 0,
  rejected: 0,
  deduplicated: 0,
  metricHits: 0,
  conversions: 0,
  websiteId: null,
};

type Assignment = Awaited<
  ReturnType<typeof assignmentRepo.listActiveAssignmentsForVisitor>
>[number];

export async function ingest(payload: unknown): Promise<IngestResult> {
  const parsed = eventBatchSchema.safeParse(payload);
  if (!parsed.success) return EMPTY;

  const { v, siteId, visitorId: anonymousId, events } = parsed.data;

  const website = await websiteService.resolveWebsiteByPublicSiteId(siteId);
  if (!website) {
    return { ...EMPTY, rejected: events.length };
  }

  const now = Date.now();
  const result: IngestResult = { ...EMPTY, websiteId: website.id };

  // Experiments are resolved once per batch: a batch usually concerns one experiment, and this
  // keeps a 50-event payload from issuing 50 identical queries.
  const experiments = new Map<string, configRepo.IngestExperiment | null>();

  // The visitor row is created lazily, only once an experiment event has proved worth storing —
  // otherwise a payload naming nothing but paused experiments would still leave a visitor
  // behind. Site events never create one: a page view outside any experiment is not a visitor
  // *of an experiment*, and a conversion needs an assignment, which needs a visitor already.
  let visitorId: string | null = null;
  let visitorResolved = false;
  const resolveVisitor = async () => {
    if (!visitorResolved && visitorId === null) {
      visitorId = (await visitorRepo.findVisitor(website.id, anonymousId))?.id ?? null;
    }
    visitorResolved = true;
    return visitorId;
  };

  // Loaded on first use, after the batch's experiment events — the SDK puts `page` last, so an
  // assignment reported on this same page load is already stored when the page is evaluated.
  let metrics: MetricDef[] | null = null;
  let assignments: Assignment[] | null = null;

  for (const event of events) {
    if (event.type === "page" || event.type === "track") {
      const url = normalizeUrl(event.url);
      if (!url) {
        result.rejected += 1;
        continue;
      }
      metrics ??= await configRepo.listWebsiteMetrics(website.id);
      const visitor = await resolveVisitor();
      if (visitor !== null) {
        assignments ??= await assignmentRepo.listActiveAssignmentsForVisitor(visitor, website.id);
      }
      await recordSiteEvent(result, {
        websiteId: website.id,
        visitorId: visitor,
        event,
        url,
        occurredAt: clampClientTimestamp(event.ts, now),
        metrics,
        assignments: assignments ?? [],
      });
      continue;
    }

    const url = normalizeUrl(event.url);
    if (!url) {
      result.rejected += 1;
      continue;
    }

    if (!experiments.has(event.experimentId)) {
      experiments.set(
        event.experimentId,
        await configRepo.findIngestExperiment(event.experimentId, website.id),
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

    // v3 only (the v4 schema refuses `conversion`): a conversion must be on the page the
    // experiment counts as its URL goal. Without this the URL is whatever the client says it is,
    // and a crafted payload could book a conversion from anywhere. An experiment whose primary
    // goal is a metric has no URL goal for a v3 bundle to meet.
    if (
      event.type === "conversion" &&
      (v !== 3 ||
        experiment.goalMetricId !== null ||
        experiment.conversionUrl === null ||
        !urlMatches(url, experiment.conversionUrl, experiment.conversionMatchType))
    ) {
      result.rejected += 1;
      continue;
    }

    visitorId ??= (await visitorRepo.upsertVisitor(website.id, anonymousId, new Date(now))).id;
    visitorResolved = true;

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

    // A new assignment changes which goals later site events in this batch can meet.
    assignments = null;

    if (event.type === "page_view" && (await isDuplicatePageView(assignment.id, url, occurredAt))) {
      result.deduplicated += 1;
      continue;
    }

    if (event.type === "conversion") {
      // A repeat conversion is a no-op, not an error: the unique constraint absorbs it, and
      // counting it as rejected would misreport a refresh as a failure.
      if (await conversionRepo.findConversion(assignment.id, URL_GOAL_KEY)) {
        result.deduplicated += 1;
        continue;
      }
      if (
        await recordConversion({
          websiteId: website.id,
          experimentId: experiment.id,
          visitorId,
          assignmentId: assignment.id,
          variantId: assignment.variantId,
          goalKey: URL_GOAL_KEY,
          url,
          occurredAt,
        })
      ) {
        result.conversions += 1;
      }
      result.accepted += 1;
      continue;
    }

    await eventRepo.createEvents(
      [
        {
          websiteId: website.id,
          experimentId: experiment.id,
          visitorId,
          assignmentId: assignment.id,
          // The stored arm, not the reported one.
          variantId: assignment.variantId,
          type: event.type as EventType,
          url,
          durationMs: (event as TrackedEventInput).durationMs ?? null,
          occurredAt,
        },
      ],
      db,
    );

    result.accepted += 1;
  }

  return result;
}

/**
 * A `page` or `track` event: record a hit for every metric it matches, then a conversion for
 * every goal it meets among the visitor's existing assignments.
 */
async function recordSiteEvent(
  result: IngestResult,
  input: {
    websiteId: string;
    visitorId: string | null;
    event: SiteEventInput;
    url: string;
    occurredAt: Date;
    metrics: MetricDef[];
    assignments: Assignment[];
  },
): Promise<void> {
  const site: SiteEvent =
    input.event.type === "track"
      ? { type: "track", key: input.event.key }
      : { type: "page", url: input.url };

  const hit = metricsHit(site, input.metrics);
  if (hit.length > 0) {
    await eventRepo.createMetricHits(
      hit.map((metric) => ({
        websiteId: input.websiteId,
        metricId: metric.id,
        url: input.url,
        occurredAt: input.occurredAt,
      })),
    );
    result.metricHits += hit.length;
  }

  if (input.visitorId === null) return;

  const hitIds = new Set(hit.map((metric) => metric.id));
  let converted = false;

  for (const assignment of input.assignments) {
    for (const goalKey of goalsMet(assignment.experiment, site, hitIds)) {
      const first = await recordConversion({
        websiteId: input.websiteId,
        experimentId: assignment.experimentId,
        visitorId: input.visitorId,
        assignmentId: assignment.id,
        variantId: assignment.variantId,
        goalKey,
        url: input.url,
        occurredAt: input.occurredAt,
      });
      if (first) result.conversions += 1;
      converted = true;
    }
  }

  if (converted) result.accepted += 1;
}

/**
 * Records one conversion occurrence: a `Conversion` row — unique per assignment and goal, so a
 * refresh cannot inflate the UNIQUE count — and a `conversion` event, which counting mode ALL
 * counts every time, except for a repeat inside the burst window. Returns true when the
 * `Conversion` row was new.
 */
async function recordConversion(input: {
  websiteId: string;
  experimentId: string;
  visitorId: string;
  assignmentId: string;
  variantId: string | null;
  goalKey: string;
  url: string;
  occurredAt: Date;
}): Promise<boolean> {
  const first = await conversionRepo.recordConversion({
    experimentId: input.experimentId,
    visitorId: input.visitorId,
    assignmentId: input.assignmentId,
    variantId: input.variantId,
    url: input.url,
    goalKey: input.goalKey,
    occurredAt: input.occurredAt,
  });

  const burst = await eventRepo.hasRecentConversionEvent({
    assignmentId: input.assignmentId,
    goalKey: input.goalKey,
    url: input.url,
    since: new Date(input.occurredAt.getTime() - DEDUPE_WINDOW_MS),
    until: new Date(input.occurredAt.getTime() + DEDUPE_WINDOW_MS),
  });

  if (!burst) {
    await eventRepo.createEvents([
      {
        websiteId: input.websiteId,
        experimentId: input.experimentId,
        visitorId: input.visitorId,
        assignmentId: input.assignmentId,
        variantId: input.variantId,
        type: "conversion",
        url: input.url,
        goalKey: input.goalKey,
        occurredAt: input.occurredAt,
      },
    ]);
  }

  return first;
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
  const since = new Date(occurredAt.getTime() - DEDUPE_WINDOW_MS);

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
