import "server-only";

import {
  type AccountOverview,
  type DashboardProject,
  SPARK_DAYS,
  TOP_PROJECTS,
  rankProjects,
} from "@/lib/dashboard";
import { can } from "@/lib/permissions";
import { trackingStatus } from "@/lib/pixel-status";
import { needsAction } from "@/lib/project-dashboard";
import { projectTile, seenAgo, trackFromState } from "@/lib/projects";
import { dailyVisitors, visitors30 } from "@/lib/visitors";
import { notFound } from "@/server/errors";
import * as projectRepo from "@/server/repositories/project.repository";
import * as workspaceRepo from "@/server/repositories/workspace.repository";

/**
 * The Dashboard's read model (spec §2.2): three stat cards for the workspace and its top five
 * projects. Only what the design renders is computed — the prototype's unbound experiments table
 * and charts live on each project's own dashboard instead.
 *
 * Numbers come from the shared definitions: tracking status from `lib/pixel-status`, visitors
 * from `lib/visitors` (`visitors30` = distinct visitors, D8), experiment counts grouped by status.
 */

/**
 * The active workspace at a glance. NOT_FOUND when the actor is not a member of `workspaceId`.
 * Visitor queries run only for the five projects the card shows.
 */
export async function getAccountOverview(
  actorUserId: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<AccountOverview> {
  const workspace = await workspaceRepo.findWorkspaceForMember(workspaceId, actorUserId);
  if (!workspace) throw notFound("That workspace does not exist.");

  const [records, statuses, withTraffic] = await Promise.all([
    projectRepo.listProjects(workspaceId, actorUserId),
    projectRepo.listExperimentStatuses(workspaceId, actorUserId),
    projectRepo.activeExperimentsWithTraffic(workspaceId, actorUserId),
  ]);

  const experiments = { total: 0, drafts: 0, paused: 0, completed: 0, running: 0 };
  const perProject = new Map<
    string,
    { experiments: number; running: number; needAction: number }
  >();
  for (const row of statuses) {
    experiments.total += 1;
    if (row.status === "DRAFT") experiments.drafts += 1;
    if (row.status === "PAUSED") experiments.paused += 1;
    if (row.status === "COMPLETED") experiments.completed += 1;
    if (row.status === "ACTIVE") experiments.running += 1;

    const c = perProject.get(row.websiteId) ?? { experiments: 0, running: 0, needAction: 0 };
    c.experiments += 1;
    if (row.status === "ACTIVE") c.running += 1;
    if (needsAction(row.status, withTraffic.has(row.id))) c.needAction += 1;
    perProject.set(row.websiteId, c);
  }

  const rows = records.map((record) => {
    const tracking = trackingStatus(record, now);
    return {
      record,
      track: trackFromState(tracking.state),
      when: seenAgo(tracking.seenAt, now),
      ...(perProject.get(record.id) ?? { experiments: 0, running: 0, needAction: 0 }),
    };
  });

  const top = rankProjects(rows).slice(0, TOP_PROJECTS);
  // Each id was loaded through the membership filter, so it is authorized for the visitor reads.
  const visitors = await Promise.all(
    top.map(async ({ record }) => {
      const [total, days] = await Promise.all([
        visitors30(record.id, now),
        dailyVisitors(record.id, SPARK_DAYS, now),
      ]);
      return { total, series: days.map((day) => day.visitors) };
    }),
  );

  const projects: DashboardProject[] = top.map((row, index) => {
    const v = visitors[index]!;
    const hasData = v.total > 0;
    return {
      id: row.record.id,
      name: row.record.name,
      domain: row.record.domain,
      ...projectTile(row.record.name, row.record.colorIndex),
      experiments: row.experiments,
      running: row.running,
      needAction: row.needAction,
      track: row.track,
      when: row.when,
      visitors30: hasData ? v.total : null,
      series: hasData ? v.series : null,
    };
  });

  return {
    workspaceName: workspace.name,
    canManage: can(workspace.role, "project.manage"),
    projectCount: records.length,
    trackingActive: rows.filter((row) => row.track === "active").length,
    experiments,
    runningProjects: rows.filter((row) => row.running > 0).length,
    projects,
  };
}
