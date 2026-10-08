import "server-only";

import type { Metric, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for project metrics and their hits.
 *
 * Ownership flows through the parent website: every read here takes the project id *and* the
 * user id, so a metric id from a form body cannot reach another customer's project.
 */

export function listMetricsForProject(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Metric[]> {
  return client.metric.findMany({
    where: { websiteId, website: { userId } },
    orderBy: [{ system: "desc" }, { createdAt: "asc" }],
  });
}

export function findMetricForProject(
  metricId: string,
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Metric | null> {
  return client.metric.findFirst({
    where: { id: metricId, websiteId, website: { userId } },
  });
}

/** Metric ids among `ids` that belong to the project. Never trusts the caller's list. */
export async function ownedMetricIds(
  websiteId: string,
  ids: readonly string[],
  client: DbClient = db,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await client.metric.findMany({
    where: { websiteId, id: { in: [...ids] } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

export function createMetric(
  data: Prisma.MetricUncheckedCreateInput,
  client: DbClient = db,
): Promise<Metric> {
  return client.metric.create({ data });
}

/** Ensures the system `page_view` metric exists. Idempotent. */
export function ensurePageViewMetric(websiteId: string, client: DbClient = db): Promise<Metric> {
  return client.metric.upsert({
    where: { websiteId_key: { websiteId, key: "page_view" } },
    create: { websiteId, name: "Page view", kind: "PAGE_VISIT", key: "page_view", system: true },
    update: {},
  });
}

export function deleteMetric(
  metricId: string,
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.metric.deleteMany({
    where: { id: metricId, websiteId, system: false, website: { userId } },
  });
}

/** Latest hit and 24-hour hit count per metric of one project. */
export async function hitStats(
  websiteId: string,
  since: Date,
  client: DbClient = db,
): Promise<Map<string, { last: Date | null; count24h: number }>> {
  const [latest, recent] = await Promise.all([
    client.metricHit.groupBy({
      by: ["metricId"],
      where: { websiteId },
      _max: { occurredAt: true },
    }),
    client.metricHit.groupBy({
      by: ["metricId"],
      where: { websiteId, occurredAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  const stats = new Map<string, { last: Date | null; count24h: number }>();
  for (const row of latest) {
    stats.set(row.metricId, { last: row._max.occurredAt, count24h: 0 });
  }
  for (const row of recent) {
    const entry = stats.get(row.metricId) ?? { last: null, count24h: 0 };
    entry.count24h = row._count._all;
    stats.set(row.metricId, entry);
  }
  return stats;
}

/** The latest hit of one metric, or null. */
export async function lastHit(metricId: string, client: DbClient = db): Promise<Date | null> {
  const row = await client.metricHit.findFirst({
    where: { metricId },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return row?.occurredAt ?? null;
}
