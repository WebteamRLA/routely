import "server-only";

import type { EventType } from "@/generated/prisma/client";
import { isSameSite, normalizeUrl, urlMatches } from "@/lib/url";
import { db } from "@/server/db";
import * as assignmentRepo from "@/server/repositories/assignment.repository";
import * as conversionRepo from "@/server/repositories/conversion.repository";
import * as eventRepo from "@/server/repositories/event.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import * as pageVisitorDayRepo from "@/server/repositories/page-visitor-day.repository";
import * as visitorDayRepo from "@/server/repositories/visitor-day.repository";
import * as visitorRepo from "@/server/repositories/visitor.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import * as websiteService from "@/server/services/website.service";
import { utcDayKey } from "@/lib/utc-day";
import { clampClientTimestamp, eventBatchSchema, pageHitSchema } from "@/validation/tracking";

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
  /**
   * Experiments at least one event of this batch was recorded against — each re-checked against
   * the website and ACTIVE by this service, never taken from the payload. The route hands them to
   * the throttled RESULT_READY check (`server/jobs/result-ready.ts`) after responding.
   */
  experimentIds: string[];
}

const EMPTY: IngestResult = {
  accepted: 0,
  rejected: 0,
  deduplicated: 0,
  websiteId: null,
  experimentIds: [],
};

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
    experimentIds: [],
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
    // An ACTIVE experiment always has a goal (launch requires one); the null check only keeps a
    // row that somehow lacks it from matching anything.
    if (
      event.type === "conversion" &&
      (experiment.conversionUrl === null ||
        !urlMatches(url, experiment.conversionUrl, experiment.conversionMatchType))
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
    if (!result.experimentIds.includes(experiment.id)) result.experimentIds.push(experiment.id);
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

/**
 * How often a site-wide hit may move `Website.lastSeenAt`. Tracking status has a 24-hour
 * threshold and shows "just now" below a minute, so a minute of staleness is invisible, and it
 * turns a busy site's thousands of hits a minute into one write.
 */
export const LAST_SEEN_THROTTLE_MS = 60_000;

export interface HitResult {
  /** False when the payload was malformed or named a website that does not exist. */
  recorded: boolean;
  /** The website the hit resolved to, from the public site id. */
  websiteId: string | null;
  /** A new `website_visitor_days` row was written (first hit today from this browser). */
  newVisitorDay: boolean;
  /** A new `page_visitor_days` row was written (first hit on this page today from this browser). */
  newPageDay: boolean;
  /** This hit won the throttled `lastSeenAt` compare-and-set. */
  touchedLastSeen: boolean;
}

const NO_HIT: HitResult = {
  recorded: false,
  websiteId: null,
  newVisitorDay: false,
  newPageDay: false,
  touchedLastSeen: false,
};

/**
 * Records one site-wide page hit (`POST /api/v1/hit`) — the same trust rules as `ingest`:
 *
 *  - The **website** comes from the public site id; nothing in the payload names a row.
 *  - The **URL is normalised server-side** and must be on the website's own domain — a hit for a
 *    page elsewhere is an assertion about somebody else's site and is dropped, so it can neither
 *    inflate a baseline nor vouch for a tracking check here.
 *  - The **day comes from the clamped timestamp**, so a browser whose clock is a week off still
 *    counts towards (at most) yesterday or today, never an arbitrary date.
 *  - Writes are **rows with ON CONFLICT DO NOTHING**, so a duplicated or replayed hit is a no-op
 *    and the counts stay a pure `count(*)`.
 *  - `lastSeenAt` moves through a throttled compare-and-set, never a read-then-write.
 *
 * Never throws for bad input; a database failure propagates to the route, which swallows it.
 */
export async function recordHit(payload: unknown, now: Date = new Date()): Promise<HitResult> {
  const parsed = pageHitSchema.safeParse(payload);
  if (!parsed.success) return NO_HIT;

  const { siteId, anonymousId } = parsed.data;

  const url = normalizeUrl(parsed.data.url);
  if (!url) return NO_HIT;

  const website = await websiteService.resolveWebsiteByPublicSiteId(siteId);
  if (!website) return NO_HIT;

  if (!isSameSite(url, website.domain)) return { ...NO_HIT, websiteId: website.id };

  const occurredAt = clampClientTimestamp(parsed.data.ts, now.getTime());
  const day = new Date(`${utcDayKey(occurredAt)}T00:00:00.000Z`);

  const [newVisitorDay, newPageDay, touchedLastSeen] = await Promise.all([
    visitorDayRepo.insertWebsiteVisitorDay({ websiteId: website.id, day, anonymousId }),
    pageVisitorDayRepo.insertPageVisitorDay({
      websiteId: website.id,
      urlKey: url,
      day,
      anonymousId,
    }),
    // "Last seen" is the moment the server received evidence, not the browser's claim of when.
    websiteRepo.touchLastSeen(website.id, now, LAST_SEEN_THROTTLE_MS),
  ]);

  return { recorded: true, websiteId: website.id, newVisitorDay, newPageDay, touchedLastSeen };
}
