import "server-only";

import { env } from "@/env";
import { formatMonthDayYear } from "@/lib/experiment-time";
import { isSetupComplete, launchSummary } from "@/lib/launch-rules";
import { can, canDeleteExperiment } from "@/lib/permissions";
import { trackingStatus } from "@/lib/pixel-status";
import {
  type PdExperiment,
  type ProjectHeader,
  type ProjectVisitors,
  deriveExperimentRow,
  sortExperimentRows,
} from "@/lib/project-dashboard";
import { projectTile, trackFromState } from "@/lib/projects";
import type { ArmCounts } from "@/lib/verdict";
import { dailyVisitors, dayWindow } from "@/lib/visitors";
import { notFound } from "@/server/errors";
import * as projectRepo from "@/server/repositories/project.repository";
import * as visitorDayRepo from "@/server/repositories/visitor-day.repository";
import { creatorLabel } from "@/server/services/project.service";

/**
 * A project's dashboard (spec §2.4), in three independently loaded parts so one failing query
 * cannot blank the page:
 *
 *  - `getProjectHeader` — the project, its tracking pixel and what the viewer may do. Also the
 *    access check: NOT_FOUND for anyone outside the project's workspace. Loaded before anything
 *    streams, so a stranger's request gets a real 404.
 *  - `getProjectExperiments` — every experiment as a table row (needs action, note, action) and,
 *    from the same counts, the conversions chart.
 *  - `getProjectVisitors` — 90 days of daily visitors for the line chart, plus distinct visitors
 *    over each range so its caption reconciles with Projects and the Dashboard (D8).
 */

export async function getProjectHeader(
  actorUserId: string,
  websiteId: string,
  now: Date = new Date(),
): Promise<ProjectHeader> {
  const access = await projectRepo.findProjectAccess(websiteId, actorUserId);
  if (!access) throw notFound("That project does not exist.");
  const { project: record, role } = access;

  const tracking = trackingStatus(record, now);
  return {
    project: {
      id: record.id,
      name: record.name,
      domain: record.domain,
      protocol: record.protocol,
      ...projectTile(record.name, record.colorIndex),
      key: record.publicSiteId,
      created: formatMonthDayYear(record.createdAt),
      by: creatorLabel(record.createdBy),
    },
    pixel: {
      status: trackFromState(tracking.state),
      when: tracking.when ?? "",
      ...(tracking.since ? { since: tracking.since } : {}),
    },
    permissions: {
      manageProject: can(role, "project.manage"),
      editExperiments: can(role, "experiment.edit"),
      deleteExperiments: canDeleteExperiment(role, "COMPLETED"),
      verifyPixel: can(role, "pixel.verify"),
    },
    sdkUrl: env.SDK_URL,
  };
}

/** Per-arm counts keyed `experimentId|variantId` ("" for Control). */
function armMap(rows: readonly projectRepo.ArmCountRow[]): Map<string, number> {
  return new Map(rows.map((row) => [`${row.experimentId}|${row.variantId ?? ""}`, row.count]));
}

/**
 * Every experiment of the project as a table row, in display order (needs action first). The
 * conversions chart is derived from the same rows on the client, so the bar and the row can never
 * disagree.
 */
export async function getProjectExperiments(
  actorUserId: string,
  websiteId: string,
  now: Date = new Date(),
): Promise<PdExperiment[]> {
  const record = await projectRepo.findProject(websiteId, actorUserId);
  if (!record) throw notFound("That project does not exist.");

  const [experiments, assignments, conversions] = await Promise.all([
    projectRepo.listProjectExperiments(websiteId, actorUserId),
    projectRepo.countAssignmentsByArm(websiteId, actorUserId),
    projectRepo.countConversionsByArm(websiteId, actorUserId),
  ]);
  const visitors = armMap(assignments);
  const converted = armMap(conversions);
  const count = (map: Map<string, number>, experimentId: string, variantId: string | null) =>
    map.get(`${experimentId}|${variantId ?? ""}`) ?? 0;

  const rows = experiments.map((exp) => {
    const arms: ArmCounts[] = [
      {
        name: "Control",
        visitors: count(visitors, exp.id, null),
        conversions: count(converted, exp.id, null),
      },
      ...exp.variants.map((variant) => ({
        name: variant.name,
        visitors: count(visitors, exp.id, variant.id),
        conversions: count(converted, exp.id, variant.id),
      })),
    ];

    const rules = {
      type: exp.type,
      name: exp.name,
      controlUrl: exp.controlUrl,
      conversionUrl: exp.conversionUrl,
      controlWeight: exp.controlWeight,
      trafficAllocation: exp.trafficAllocation,
      targetDevices: exp.targetDevices,
      variants: exp.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        url: variant.url,
        weight: variant.weight,
        changes: variant.changes,
      })),
    };
    const setupComplete =
      exp.status === "DRAFT" && isSetupComplete(rules, { domain: record.domain });

    return deriveExperimentRow(
      {
        id: exp.id,
        name: exp.name,
        type: exp.type,
        status: exp.status,
        trafficAllocation: exp.trafficAllocation,
        publishedAt: exp.publishedAt,
        pausedAt: exp.pausedAt,
        endedAt: exp.endedAt,
        updatedAt: exp.updatedAt,
        arms,
        setupComplete,
        ...(setupComplete ? { launch: launchSummary(rules) } : {}),
      },
      now,
    );
  });

  return sortExperimentRows(rows);
}

/** The visitors chart's data. Null `days` would mean no rows at all — see `hasVisitorData`. */
export async function getProjectVisitors(
  actorUserId: string,
  websiteId: string,
  now: Date = new Date(),
): Promise<ProjectVisitors> {
  const record = await projectRepo.findProject(websiteId, actorUserId);
  if (!record) throw notFound("That project does not exist.");

  // Authorized above; the visitor reads take a website the caller already loaded.
  const distinct = (days: number) => {
    const window = dayWindow(days, now);
    return visitorDayRepo.countDistinctVisitors(record.id, window.from, window.to);
  };
  const [days, d7, d30, d90] = await Promise.all([
    dailyVisitors(record.id, 90, now),
    distinct(7),
    distinct(30),
    distinct(90),
  ]);

  return {
    days: days.map((day) => ({ day: day.day, v: day.visitors })),
    totals: { 7: d7, 30: d30, 90: d90 },
  };
}

/** False when no visitor was recorded in the whole 90-day window — the chart's empty state. */
export function hasVisitorData(visitors: ProjectVisitors): boolean {
  return visitors.days.some((day) => day.v > 0);
}
