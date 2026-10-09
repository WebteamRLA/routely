import "server-only";

import type { DailyPoint, DashboardData } from "@/lib/view-models";
import { db } from "@/server/db";
import { primaryGoalKey } from "@/server/mappers";
import * as activityRepo from "@/server/repositories/activity.repository";
import * as connectionRepo from "@/server/repositories/sheets-connection.repository";
import * as targetRepo from "@/server/repositories/website-sheet-target.repository";
import { listForProject } from "@/server/services/experiment.service";
import { canUseSheets } from "@/server/services/google-oauth.service";
import { listProjectMetrics } from "@/server/services/metric.service";
import { requireProject } from "@/server/services/website.service";
import { addDays, dayKeyInZone, daysBetween, startOfDayInZone } from "@/server/time/zoned-day";

/**
 * The project dashboard ("Overview"): every experiment with all-time totals, the last 14
 * project-local days of experiment traffic, silent metrics, the newest activity rows and whether
 * Google Sheets really exports this project.
 *
 * Verdicts ("ready to call", lift) are not computed here: the page runs `lib/stats` /
 * `lib/verdict` over each experiment's `totals`, with the project's threshold, so the
 * dashboard and the results page can never disagree about the same numbers.
 */

/** "Visitors over time" shows 14 project-local days; its delta compares the last 7 with the 7 before. */
const WINDOW_DAYS = 14;
/** Rows in the dashboard's "Team activity" card. */
const ACTIVITY_ROWS = 6;

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

  const [experiments, metrics, assignments, conversions, goalRows, activity, sheetsConnected] =
    await Promise.all([
      listForProject(actorUserId, project.id, { sort: "updated" }, now),
      listProjectMetrics(actorUserId, project.id, now),
      db.assignment.findMany({
        where: { experiment: { websiteId: project.id }, assignedAt: { gte: from } },
        select: { assignedAt: true, visitorId: true },
      }),
      db.conversion.findMany({
        where: { experiment: { websiteId: project.id }, occurredAt: { gte: from } },
        select: { occurredAt: true, experimentId: true, goalKey: true },
      }),
      db.experiment.findMany({
        where: { websiteId: project.id },
        select: { id: true, goalMetricId: true },
      }),
      activityRepo.listRecentForWebsite(project.id, actorUserId, ACTIVITY_ROWS),
      exportsToSheets(actorUserId, project.id),
    ]);

  // Visitors: distinct visitors newly assigned each day — a visitor entering two experiments the
  // same day counts once. Assignments are the source of truth for visitors (CLAUDE.md §5).
  const index = new Map(days.map((day, i) => [day, i]));
  const perDay = days.map(() => new Set<string>());
  const window = new Set<string>();
  for (const row of assignments) {
    const i = index.get(dayKeyInZone(row.assignedAt, tz));
    if (i === undefined) continue;
    perDay[i]!.add(row.visitorId);
    window.add(row.visitorId);
  }
  const daily: DailyPoint[] = perDay.map((set) => ({ v: set.size, c: 0 }));

  // Conversions on each experiment's primary goal only — the same number its results show.
  const goalKeyById = new Map(goalRows.map((row) => [row.id, primaryGoalKey(row)]));
  for (const row of conversions) {
    if (row.goalKey !== goalKeyById.get(row.experimentId)) continue;
    const i = index.get(dayKeyInZone(row.occurredAt, tz));
    if (i !== undefined) daily[i]!.c += 1;
  }

  return {
    timezone: tz,
    days,
    daily,
    uniqueVisitors: window.size,
    experiments,
    silentMetrics: metrics.filter((m) => !m.system && m.lastReceivedAt === null),
    activity: activity.map((row) => ({
      id: row.id,
      experimentId: row.experimentId,
      text: row.text,
      actorName: row.actorName,
      createdAt: row.createdAt.toISOString(),
    })),
    sheetsConnected,
  };
}

/**
 * True only when this project really exports: the account's Google grant is connected with the
 * Sheets scope, and this website has a spreadsheet attached. Either alone exports nothing.
 */
async function exportsToSheets(actorUserId: string, websiteId: string): Promise<boolean> {
  const [connection, target] = await Promise.all([
    connectionRepo.findConnectionForUser(actorUserId),
    targetRepo.findTargetForWebsite(websiteId, actorUserId),
  ]);
  return (
    !!target &&
    !!connection &&
    connection.status === "CONNECTED" &&
    canUseSheets(connection.grantedScopes)
  );
}
