import "server-only";

import type {
  DeviceType,
  ExperimentStatus,
  ExperimentType,
  MemberRole,
  Prisma,
  SiteProtocol,
} from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import {
  actorMembershipSelect,
  experimentAccess,
  websiteAccess,
} from "@/server/repositories/access";

/**
 * Projects (websites, as the new design names them): the create / edit / delete writes behind its
 * dialogs, and the grouped reads behind the Dashboard, Projects and Project dashboard screens.
 *
 * Every function takes the actor's `userId` and folds the workspace-membership filter
 * (`access.ts`) into its `where`, so a non-member's request matches nothing. Counts come from
 * rows (`count(assignments)`, `count(conversions)`) grouped in the database — never from a
 * counter column, which is what keeps every screen's numbers reconcilable with each other.
 */

/** The website columns the project screens render. */
const projectSelect = {
  id: true,
  workspaceId: true,
  name: true,
  domain: true,
  protocol: true,
  publicSiteId: true,
  colorIndex: true,
  lastSeenAt: true,
  pixelVerifiedAt: true,
  createdAt: true,
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.WebsiteSelect;

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  protocol: SiteProtocol;
  publicSiteId: string;
  colorIndex: number;
  lastSeenAt: Date | null;
  pixelVerifiedAt: Date | null;
  createdAt: Date;
  createdBy: { name: string | null; email: string } | null;
}

/** A workspace's projects, oldest first (the order the Projects table lists them in). */
export function listProjects(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<ProjectRecord[]> {
  return client.website.findMany({
    where: websiteAccess(userId, { workspaceId }),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: projectSelect,
  });
}

/** One project the user can see, or null. */
export function findProject(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<ProjectRecord | null> {
  return client.website.findFirst({
    where: { id: websiteId, ...websiteAccess(userId) },
    select: projectSelect,
  });
}

/**
 * One project the user can see, with the role they hold in its workspace — so a service can tell
 * NOT_FOUND (not a member) from FORBIDDEN (a member without the role) in one read.
 */
export async function findProjectAccess(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<{ project: ProjectRecord; role: MemberRole } | null> {
  const row = await client.website.findFirst({
    where: { id: websiteId, ...websiteAccess(userId) },
    select: { ...projectSelect, workspace: { select: actorMembershipSelect(userId) } },
  });
  const role = row?.workspace.memberships[0]?.role;
  if (!row || !role) return null;
  const { workspace: _workspace, ...project } = row;
  return { project, role };
}

export function createProject(
  data: {
    workspaceId: string;
    createdById: string;
    name: string;
    domain: string;
    protocol: SiteProtocol;
    publicSiteId: string;
    colorIndex: number;
  },
  client: DbClient = db,
): Promise<{ id: string }> {
  return client.website.create({ data, select: { id: true } });
}

/**
 * Renames / re-addresses a project. The tenant and role filter is part of the write; so is, for a
 * domain change, "no running or paused experiment" — a launch racing this edit cannot slip in
 * between a check and the write. A count of 0 means one of those conditions did not hold.
 */
export function updateProject(
  websiteId: string,
  userId: string,
  roles: readonly MemberRole[],
  data: Prisma.WebsiteUpdateManyMutationInput,
  options: { requireNoLiveExperiments: boolean },
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.updateMany({
    where: {
      id: websiteId,
      ...websiteAccess(userId, { roles }),
      ...(options.requireNoLiveExperiments
        ? { experiments: { none: { status: { in: ["ACTIVE", "PAUSED"] } } } }
        : {}),
    },
    data,
  });
}

/**
 * Deletes a project — only while it still has the name the actor confirmed, so a rename in another
 * tab between opening the dialog and confirming it deletes nothing. Experiments, visitors, events,
 * conversions, visitor-day rows and the sheet target go with it (database cascades).
 */
export function deleteProject(
  websiteId: string,
  userId: string,
  roles: readonly MemberRole[],
  confirmedName: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.website.deleteMany({
    where: { id: websiteId, name: confirmedName, ...websiteAccess(userId, { roles }) },
  });
}

/** The identity fields the duplicate-name and duplicate-domain rules compare against. */
export function listProjectIdentities(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<{ id: string; name: string; domain: string }[]> {
  return client.website.findMany({
    where: websiteAccess(userId, { workspaceId }),
    select: { id: true, name: true, domain: true },
  });
}

export interface ExperimentStatusRow {
  id: string;
  websiteId: string;
  status: ExperimentStatus;
}

/**
 * Every experiment in a workspace (or, with `websiteId`, in one of its projects) — just enough to
 * count them by project and status.
 */
export function listExperimentStatuses(
  workspaceId: string,
  userId: string,
  websiteId?: string,
  client: DbClient = db,
): Promise<ExperimentStatusRow[]> {
  return client.experiment.findMany({
    where: { ...(websiteId ? { websiteId } : {}), ...experimentAccess(userId, { workspaceId }) },
    select: { id: true, websiteId: true, status: true },
  });
}

/**
 * ACTIVE experiments in a workspace that have at least one assigned visitor. An ACTIVE experiment
 * missing from this set "needs action" (awaiting traffic / no traffic).
 */
export async function activeExperimentsWithTraffic(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<Set<string>> {
  const rows = await client.assignment.groupBy({
    by: ["experimentId"],
    where: { experiment: { status: "ACTIVE", ...experimentAccess(userId, { workspaceId }) } },
    _count: { _all: true },
  });
  return new Set(rows.map((row) => row.experimentId));
}

export interface ProjectExperimentRecord {
  id: string;
  name: string;
  type: ExperimentType;
  status: ExperimentStatus;
  controlUrl: string | null;
  conversionUrl: string | null;
  controlWeight: number;
  trafficAllocation: number;
  targetDevices: DeviceType[];
  wizardStep: number;
  publishedAt: Date | null;
  pausedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
  variants: {
    id: string;
    position: number;
    name: string;
    url: string | null;
    changes: Prisma.JsonValue;
    weight: number;
  }[];
}

/** Every experiment of one website, with its variants in position order. */
export function listProjectExperiments(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<ProjectExperimentRecord[]> {
  return client.experiment.findMany({
    where: { websiteId, ...experimentAccess(userId) },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      controlUrl: true,
      conversionUrl: true,
      controlWeight: true,
      trafficAllocation: true,
      targetDevices: true,
      wizardStep: true,
      publishedAt: true,
      pausedAt: true,
      endedAt: true,
      updatedAt: true,
      variants: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, name: true, url: true, changes: true, weight: true },
      },
    },
  });
}

/** One arm's count: `variantId` null is Control. */
export interface ArmCountRow {
  experimentId: string;
  variantId: string | null;
  count: number;
}

/** `count(assignments)` per experiment and arm, for one website. */
export async function countAssignmentsByArm(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<ArmCountRow[]> {
  const rows = await client.assignment.groupBy({
    by: ["experimentId", "variantId"],
    where: { experiment: { websiteId, ...experimentAccess(userId) } },
    _count: { _all: true },
  });
  return rows.map((row) => ({
    experimentId: row.experimentId,
    variantId: row.variantId,
    count: row._count._all,
  }));
}

/** `count(conversions)` per experiment and arm, for one website. */
export async function countConversionsByArm(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<ArmCountRow[]> {
  const rows = await client.conversion.groupBy({
    by: ["experimentId", "variantId"],
    where: { experiment: { websiteId, ...experimentAccess(userId) } },
    _count: { _all: true },
  });
  return rows.map((row) => ({
    experimentId: row.experimentId,
    variantId: row.variantId,
    count: row._count._all,
  }));
}

/** Experiments on a website that are running or paused — they block a domain change. */
export function countLiveExperiments(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<number> {
  return client.experiment.count({
    where: { websiteId, status: { in: ["ACTIVE", "PAUSED"] }, ...experimentAccess(userId) },
  });
}
