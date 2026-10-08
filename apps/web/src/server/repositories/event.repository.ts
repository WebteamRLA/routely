import "server-only";

import type { EventType, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for the append-only event log.
 */

export interface EventRecordInput {
  websiteId: string;
  experimentId: string;
  visitorId: string;
  assignmentId: string;
  /** `null` is the control arm — see schema.prisma's header comment. */
  variantId: string | null;
  type: EventType;
  url: string;
  durationMs?: number | null;
  /** Conversion events only: `"url"` or the metric id. */
  goalKey?: string | null;
  occurredAt: Date;
}

/** Inserts a batch in one statement. Events are never updated, so a plain insert suffices. */
export function createEvents(
  events: EventRecordInput[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.event.createMany({ data: events });
}

/**
 * Page views per arm for one experiment, keyed by variant id (`null` is control).
 *
 * Served entirely by the `[experimentId, type, variantId, occurredAt]` index, so it stays a
 * grouped count over the index rather than a scan of the events table.
 */
export async function countPageViewsByVariant(
  experimentId: string,
  range?: { from: Date; to: Date },
  client: DbClient = db,
): Promise<Map<string | null, number>> {
  const rows = await client.event.groupBy({
    by: ["variantId"],
    where: {
      experimentId,
      type: "page_view",
      ...(range ? { occurredAt: { gte: range.from, lte: range.to } } : {}),
    },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.variantId, row._count._all]));
}

/**
 * Distinct visitors who produced a page view, per arm (`null` is control).
 *
 * Deliberately distinct from the assignment count: an assignment means a visitor was bucketed,
 * while this means they actually loaded a page. The two differ when a visitor is assigned and
 * redirected away before the variant page reports anything, so having both makes that
 * discrepancy visible rather than hiding it inside one number.
 */
export async function countPageViewVisitorsByVariant(
  experimentId: string,
  range?: { from: Date; to: Date },
  client: DbClient = db,
): Promise<Map<string | null, number>> {
  const rows = await client.event.groupBy({
    by: ["variantId", "visitorId"],
    where: {
      experimentId,
      type: "page_view",
      ...(range ? { occurredAt: { gte: range.from, lte: range.to } } : {}),
    },
  });

  const totals = new Map<string | null, number>();
  for (const row of rows) {
    totals.set(row.variantId, (totals.get(row.variantId) ?? 0) + 1);
  }
  return totals;
}

/**
 * Total reported visible time per arm, in milliseconds (`null` is control).
 *
 * Time is reported by the SDK as deltas — each event carries only what accumulated since the
 * previous one — so summing them gives total visible time with no risk of double counting a
 * running total.
 */
export async function sumVisibleMsByVariant(
  experimentId: string,
  range?: { from: Date; to: Date },
  client: DbClient = db,
): Promise<Map<string | null, number>> {
  const rows = await client.event.groupBy({
    by: ["variantId"],
    where: {
      experimentId,
      type: "time_on_page",
      ...(range ? { occurredAt: { gte: range.from, lte: range.to } } : {}),
    },
    _sum: { durationMs: true },
  });

  return new Map(rows.map((row) => [row.variantId, row._sum.durationMs ?? 0]));
}

/**
 * Whether the tracking snippet has ever reported an event for this website.
 *
 * Backs the install check's "receiving data" half: rather than a separate
 * installed/verified flag that could drift from reality, detection is derived from the one
 * thing that actually proves the snippet is running — an event arrived. Served by the
 * `[websiteId, createdAt]` index, so this is an index probe rather than a table scan.
 */
export async function hasEvents(websiteId: string, client: DbClient = db): Promise<boolean> {
  const event = await client.event.findFirst({
    where: { websiteId },
    select: { id: true },
  });

  return event !== null;
}

/**
 * True when this assignment recorded a conversion for the same goal on the same URL moments
 * ago — the burst a second copy of the SDK on one page produces. Counting mode ALL counts these
 * rows, so a duplicate would inflate it.
 */
export async function hasRecentConversionEvent(
  input: { assignmentId: string; goalKey: string; url: string; since: Date; until: Date },
  client: DbClient = db,
): Promise<boolean> {
  const existing = await client.event.findFirst({
    where: {
      assignmentId: input.assignmentId,
      type: "conversion",
      goalKey: input.goalKey,
      url: input.url,
      occurredAt: { gte: input.since, lte: input.until },
    },
    select: { id: true },
  });
  return existing !== null;
}

/** Records metric hits — one per metric a received `page` or `track` event matched. */
export function createMetricHits(
  hits: { websiteId: string; metricId: string; url: string | null; occurredAt: Date }[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.metricHit.createMany({ data: hits });
}
