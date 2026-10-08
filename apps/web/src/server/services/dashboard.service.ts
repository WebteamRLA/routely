import "server-only";

import type { DailyPoint, DashboardData } from "@/lib/view-models";
import { db } from "@/server/db";
import { primaryGoalKey } from "@/server/mappers";
import { listForProject } from "@/server/services/experiment.service";
import { listProjectMetrics } from "@/server/services/metric.service";
import { requireProject } from "@/server/services/website.service";
import { addDays, dayKeyInZone, daysBetween, startOfDayInZone } from "@/server/time/zoned-day";

/**
 * The project dashboard: KPI strip (last 14 days vs the 14 before, in the project's time zone),
 * live experiments, "needs a decision" candidates and silent metrics.
 *
 * Verdicts ("ready to call", confidence) are not computed here: the page runs `lib/stats` /
 * `lib/verdict` over each experiment's `totals`, with the project's threshold, so the
 * dashboard and the results page can never disagree about the same numbers.
 */

const WINDOW_DAYS = 28;

export async function getProjectDashboard(
  actorUserId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<DashboardData> {
  const project = await requireProject(actorUserId, projectId);
  const tz = project.timezone;

  const today = dayKeyInZone(now, tz);
  const days = daysBetween(addDays(today, -(WINDOW_DAYS - 1)), today);
  const from = startOfDayInZone(days[0]!, tz);

  const [experiments, metrics, assignments, conversions, goalRows] = await Promise.all([
    listForProject(actorUserId, project.id, { sort: "updated" }, now),
    listProjectMetrics(actorUserId, project.id, now),
    db.assignment.findMany({
      where: { experiment: { websiteId: project.id }, assignedAt: { gte: from } },
      select: { assignedAt: true },
    }),
    db.conversion.findMany({
      where: { experiment: { websiteId: project.id }, occurredAt: { gte: from } },
      select: { occurredAt: true, experimentId: true, goalKey: true },
    }),
    db.experiment.findMany({
      where: { websiteId: project.id },
      select: { id: true, goalMetricId: true },
    }),
  ]);

  // Conversions on each experiment's primary goal only — the same number its results show.
  const goalKeyById = new Map(goalRows.map((row) => [row.id, primaryGoalKey(row)]));
  const index = new Map(days.map((day, i) => [day, i]));
  const daily: DailyPoint[] = days.map(() => ({ v: 0, c: 0 }));
  for (const row of assignments) {
    const i = index.get(dayKeyInZone(row.assignedAt, tz));
    if (i !== undefined) daily[i]!.v += 1;
  }
  for (const row of conversions) {
    if (row.goalKey !== goalKeyById.get(row.experimentId)) continue;
    const i = index.get(dayKeyInZone(row.occurredAt, tz));
    if (i !== undefined) daily[i]!.c += 1;
  }

  const sum = (points: DailyPoint[]): DailyPoint => ({
    v: points.reduce((total, p) => total + p.v, 0),
    c: points.reduce((total, p) => total + p.c, 0),
  });

  const live = experiments
    .filter((e) => e.status === "running" || e.status === "paused")
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") || b.visitors - a.visitors,
    );

  return {
    timezone: tz,
    days,
    daily,
    last14: sum(daily.slice(14)),
    previous14: sum(daily.slice(0, 14)),
    runningCount: experiments.filter((e) => e.status === "running").length,
    winnersCount: experiments.filter((e) => e.displayStatus === "winner").length,
    experiments,
    live,
    needsDecision: [
      ...experiments.filter((e) => e.status === "running" && e.visitors > 0),
      ...experiments.filter((e) => e.status === "paused"),
    ],
    silentMetrics: metrics.filter((m) => !m.system && m.lastReceivedAt === null),
  };
}
