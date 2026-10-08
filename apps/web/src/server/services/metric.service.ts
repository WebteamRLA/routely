import "server-only";

import type { Metric } from "@/generated/prisma/client";
import type { MetricRow } from "@/lib/view-models";
import { db } from "@/server/db";
import { conflict, notFound, validationFailed } from "@/server/errors";
import { matchKey, onProjectDomain } from "@/server/mappers";
import * as metricRepo from "@/server/repositories/metric.repository";
import { projectDomains, requireProject } from "@/server/services/website.service";
import { parseOrThrow } from "@/server/validate";
import { createMetricSchema, deleteMetricSchema, pageVisitKey } from "@/validation/metric";

/**
 * Project metrics ("Metrics & goals"): custom events fired with `routely.track(key)` and page
 * visits. Every project has the system `page_view` metric, which cannot be deleted.
 *
 * "Last received" and the 24-hour count come from `MetricHit`, which ingestion writes whether or
 * not the visitor is in an experiment — so a metric can be verified (GTM "send test event")
 * before any experiment uses it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toRow(
  metric: Metric,
  stats: { last: Date | null; count24h: number } | undefined,
  usedIn: number,
): MetricRow {
  return {
    id: metric.id,
    name: metric.name,
    kind: metric.kind === "PAGE_VISIT" ? "page" : "event",
    key: metric.key,
    url: metric.url,
    system: metric.system,
    lastReceivedAt: stats?.last?.toISOString() ?? null,
    count24h: stats?.count24h ?? 0,
    usedIn,
    matchType: matchKey(metric.matchType),
    createdAt: metric.createdAt.toISOString(),
  };
}

/**
 * The system page_view metric's numbers. Ingestion may or may not record a `MetricHit` per page
 * view; when it has recorded none, the tracked `page_view` events are the same fact.
 */
async function pageViewStats(
  websiteId: string,
  since: Date,
): Promise<{ last: Date | null; count24h: number }> {
  const [latest, count24h] = await Promise.all([
    db.event.findFirst({
      where: { websiteId, type: "page_view" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
    db.event.count({ where: { websiteId, type: "page_view", occurredAt: { gte: since } } }),
  ]);
  return { last: latest?.occurredAt ?? null, count24h };
}

/** How many experiments use each metric as primary or secondary goal. */
async function usageCounts(websiteId: string): Promise<Map<string, number>> {
  const experiments = await db.experiment.findMany({
    where: { websiteId },
    select: { goalMetricId: true, secondaryMetricIds: true },
  });
  const used = new Map<string, number>();
  for (const experiment of experiments) {
    const ids = new Set([
      ...(experiment.goalMetricId ? [experiment.goalMetricId] : []),
      ...experiment.secondaryMetricIds,
    ]);
    for (const id of ids) used.set(id, (used.get(id) ?? 0) + 1);
  }
  return used;
}

/** Every metric of a project, system first then oldest first. */
export async function listProjectMetrics(
  actorUserId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<MetricRow[]> {
  const project = await requireProject(actorUserId, projectId);
  const since = new Date(now.getTime() - DAY_MS);

  // Created lazily for projects that predate metrics, so the system row always exists.
  await metricRepo.ensurePageViewMetric(project.id);

  const [metrics, stats, used] = await Promise.all([
    metricRepo.listMetricsForProject(project.id, actorUserId),
    metricRepo.hitStats(project.id, since),
    usageCounts(project.id),
  ]);

  const systemPageView = metrics.find((m) => m.system && m.key === "page_view");
  if (systemPageView && !stats.has(systemPageView.id)) {
    stats.set(systemPageView.id, await pageViewStats(project.id, since));
  }

  return metrics.map((metric) => toRow(metric, stats.get(metric.id), used.get(metric.id) ?? 0));
}

/**
 * Creates a metric.
 *
 * - Custom event: `key` required, snake_case (`^[a-z][a-z0-9_]*$`), unique in the project.
 * - Page visit: `url` required, a full URL on one of the project's domains; its key is
 *   `page_view_<slug of name>`.
 * - Name required and unique in the project (case-insensitive).
 *
 * Field errors are keyed `name`, `key`, `url`.
 */
export async function createMetric(actorUserId: string, input: unknown): Promise<MetricRow> {
  const data = parseOrThrow(createMetricSchema, input, "Check the metric details.");
  const project = await requireProject(actorUserId, data.projectId);
  const existing = await metricRepo.listMetricsForProject(project.id, actorUserId);

  const errors: Record<string, string[]> = {};
  if (existing.some((m) => m.name.trim().toLowerCase() === data.name.toLowerCase())) {
    errors["name"] = ["A metric with this name already exists."];
  }

  const key = data.kind === "PAGE_VISIT" ? pageVisitKey(data.name) : data.key!;
  if (existing.some((m) => m.key === key)) {
    if (data.kind === "PAGE_VISIT") {
      errors["name"] ??= ["A metric with this name already exists."];
    } else {
      errors["key"] = ["A metric with this event name already exists."];
    }
  }

  if (data.kind === "PAGE_VISIT" && data.url) {
    const domains = projectDomains(project);
    if (!onProjectDomain(data.url, domains)) {
      errors["url"] = [`Must be a URL on ${domains.join(", ")} or a subdomain.`];
    }
  }

  if (Object.keys(errors).length > 0) {
    throw validationFailed("Check the metric details.", errors);
  }

  const metric = await metricRepo.createMetric({
    websiteId: project.id,
    name: data.name,
    kind: data.kind,
    key,
    url: data.kind === "PAGE_VISIT" ? data.url! : null,
    matchType: data.kind === "PAGE_VISIT" ? data.matchType : "EXACT",
  });

  return toRow(metric, undefined, 0);
}

/**
 * Deletes a custom metric. Refuses the system metric, and a metric that is the primary goal of
 * a running or paused experiment (deleting it would leave a live test with no goal). It is
 * removed from every experiment's secondary goals in the same transaction.
 */
export async function deleteMetric(actorUserId: string, input: unknown): Promise<void> {
  const { projectId, metricId } = parseOrThrow(deleteMetricSchema, input);
  const metric = await metricRepo.findMetricForProject(metricId, projectId, actorUserId);
  if (!metric) throw notFound("That metric does not exist.");
  if (metric.system) throw conflict("The page view metric is built in and can’t be deleted.");

  const live = await db.experiment.findFirst({
    where: { websiteId: projectId, goalMetricId: metricId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { name: true, status: true },
  });
  if (live) {
    throw conflict(
      `“${metric.name}” is the primary goal of “${live.name}”, which is ${
        live.status === "ACTIVE" ? "running" : "paused"
      }. End that experiment before deleting this metric.`,
    );
  }

  await db.$transaction(async (tx) => {
    const users = await tx.experiment.findMany({
      where: { websiteId: projectId, secondaryMetricIds: { has: metricId } },
      select: { id: true, secondaryMetricIds: true },
    });
    for (const experiment of users) {
      await tx.experiment.update({
        where: { id: experiment.id },
        data: { secondaryMetricIds: experiment.secondaryMetricIds.filter((id) => id !== metricId) },
      });
    }
    const result = await metricRepo.deleteMetric(metricId, projectId, actorUserId, tx);
    if (result.count === 0) throw notFound("That metric does not exist.");
  });
}

/**
 * When a metric was last received — the GTM "send test event" check polls this until it changes
 * after the customer fires a real event. Never simulated.
 */
export async function getMetricLastReceived(
  actorUserId: string,
  projectId: string,
  metricId: string,
  now: Date = new Date(),
): Promise<{ lastReceivedAt: string | null; count24h: number }> {
  const metric = await metricRepo.findMetricForProject(metricId, projectId, actorUserId);
  if (!metric) throw notFound("That metric does not exist.");

  const since = new Date(now.getTime() - DAY_MS);
  const [last, count24h] = await Promise.all([
    metricRepo.lastHit(metric.id),
    db.metricHit.count({ where: { metricId: metric.id, occurredAt: { gte: since } } }),
  ]);
  if (!last && metric.system) {
    const stats = await pageViewStats(projectId, since);
    return { lastReceivedAt: stats.last?.toISOString() ?? null, count24h: stats.count24h };
  }
  return { lastReceivedAt: last?.toISOString() ?? null, count24h };
}
