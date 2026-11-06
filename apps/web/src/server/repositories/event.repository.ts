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
 * Occurrences of an experiment's goal event per arm, keyed by variant id (`null` is control).
 *
 * Raw occurrences, so a visitor who repeats the event counts each time. Rates never read this:
 * they divide `conversions`, which holds one row per assignment.
 */
export async function countCustomEventsByVariant(
  experimentId: string,
  client: DbClient = db,
): Promise<Map<string | null, number>> {
  const rows = await client.event.groupBy({
    by: ["variantId"],
    where: { experimentId, type: "custom" },
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

/** Most recent events for one experiment, for debugging an installation. */
export function listRecentEvents(experimentId: string, limit = 50, client: DbClient = db) {
  return client.event.findMany({
    where: { experimentId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}

/**
 * Whether the tracking snippet has ever reported an event for this website.
 *
 * Backs the "pixel detected" state on the Get started guide: rather than a separate
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
 * Deletes events older than `cutoff` for one website. The retention sweep is not scheduled in
 * the MVP; this exists so the `[websiteId, createdAt]` index has the caller it was added for.
 */
export function deleteEventsBefore(
  websiteId: string,
  cutoff: Date,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.event.deleteMany({
    where: { websiteId, createdAt: { lt: cutoff } },
  });
}
