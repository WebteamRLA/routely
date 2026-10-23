import "server-only";

import { formatMonthDayYear } from "@/lib/experiment-time";
import { can } from "@/lib/permissions";
import { trackingStatus } from "@/lib/pixel-status";
import {
  type Project,
  projectTile,
  seenAgo,
  trackFromState,
  trackingSeenLine,
} from "@/lib/projects";
import { visitors30 } from "@/lib/visitors";
import { notFound } from "@/server/errors";
import * as projectRepo from "@/server/repositories/project.repository";
import type { ProjectRecord } from "@/server/repositories/project.repository";
import * as workspaceRepo from "@/server/repositories/workspace.repository";

/**
 * The Projects screen's read model: one row per website in the workspace, with its tracking
 * status, experiment counts and 30-day visitors.
 *
 * Every number comes from the one function that defines it — `trackingStatus` (`lib/pixel-status`),
 * `visitors30` (`lib/visitors`), experiments grouped by status — so the Projects table, the
 * Dashboard and a project's own dashboard can never disagree about the same project.
 */

export interface ProjectsOverview {
  workspaceName: string;
  /** Create, edit and delete are Owner/Admin (`project.manage`); the server re-checks each. */
  canManage: boolean;
  projects: Project[];
}

/** Name for "by {name}": the creator's name, else their email, else a former member. */
export function creatorLabel(createdBy: ProjectRecord["createdBy"]): string {
  if (!createdBy) return "a former member";
  return createdBy.name?.trim() || createdBy.email;
}

/** One Projects row from a stored project and its counts. */
export function toProjectRow(
  record: ProjectRecord,
  counts: { running: number; total: number },
  visitors: number,
  now: Date,
): Project {
  const tracking = trackingStatus(record, now);
  const track = trackFromState(tracking.state);
  return {
    id: record.id,
    name: record.name,
    domain: record.domain,
    protocol: record.protocol,
    ...projectTile(record.name, record.colorIndex),
    key: record.publicSiteId,
    track,
    seen: trackingSeenLine(track, seenAgo(tracking.seenAt, now)),
    running: counts.running,
    total: counts.total,
    visitors: visitors > 0 ? visitors : null,
    created: formatMonthDayYear(record.createdAt),
    createdBy: creatorLabel(record.createdBy),
  };
}

/** Experiments per project: total and running (ACTIVE). */
function countByProject(
  rows: readonly projectRepo.ExperimentStatusRow[],
): Map<string, { running: number; total: number }> {
  const counts = new Map<string, { running: number; total: number }>();
  for (const row of rows) {
    const c = counts.get(row.websiteId) ?? { running: 0, total: 0 };
    c.total += 1;
    if (row.status === "ACTIVE") c.running += 1;
    counts.set(row.websiteId, c);
  }
  return counts;
}

/**
 * Every project in `workspaceId` (the actor's active workspace), oldest first. NOT_FOUND when the
 * actor is not a member of it.
 */
export async function listProjectsWithStats(
  actorUserId: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<ProjectsOverview> {
  const workspace = await workspaceRepo.findWorkspaceForMember(workspaceId, actorUserId);
  if (!workspace) throw notFound("That workspace does not exist.");

  const [records, statuses] = await Promise.all([
    projectRepo.listProjects(workspaceId, actorUserId),
    projectRepo.listExperimentStatuses(workspaceId, actorUserId),
  ]);
  // Each website was loaded through the membership filter above, so its id is authorized.
  const visitors = await Promise.all(records.map((record) => visitors30(record.id, now)));
  const counts = countByProject(statuses);

  return {
    workspaceName: workspace.name,
    canManage: can(workspace.role, "project.manage"),
    projects: records.map((record, index) =>
      toProjectRow(
        record,
        counts.get(record.id) ?? { running: 0, total: 0 },
        visitors[index] ?? 0,
        now,
      ),
    ),
  };
}

/** One project's Projects row — what a create or edit hands back to the table. NOT_FOUND for a non-member. */
export async function getProjectRow(
  actorUserId: string,
  websiteId: string,
  now: Date = new Date(),
): Promise<Project> {
  const record = await projectRepo.findProject(websiteId, actorUserId);
  if (!record) throw notFound("That project does not exist.");

  const [statuses, visitors] = await Promise.all([
    projectRepo.listExperimentStatuses(record.workspaceId, actorUserId, record.id),
    visitors30(record.id, now),
  ]);
  const counts = countByProject(statuses);

  return toProjectRow(record, counts.get(record.id) ?? { running: 0, total: 0 }, visitors, now);
}
