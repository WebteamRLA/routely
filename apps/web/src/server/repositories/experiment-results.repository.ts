import "server-only";

import type { ExperimentActivityType, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { experimentAccess } from "@/server/repositories/access";

/**
 * Read-only queries behind the results screens: the experiments list, an experiment's activity
 * log and per-arm counts across many experiments.
 *
 * Tenancy follows the house rule — the access filter is folded into each query's own `where` —
 * so even a list of experiment ids the caller already authorized cannot widen what is read.
 */

const LIST_SELECT = {
  id: true,
  websiteId: true,
  name: true,
  type: true,
  status: true,
  controlUrl: true,
  trafficAllocation: true,
  updatedAt: true,
  winnerChosenAt: true,
  winnerVariantId: true,
  winnerBasis: true,
  variants: {
    orderBy: { position: "asc" as const },
    select: { id: true, name: true, url: true },
  },
} satisfies Prisma.ExperimentSelect;

export type ListedExperiment = Prisma.ExperimentGetPayload<{ select: typeof LIST_SELECT }>;

/**
 * Experiments the user can see, newest change first — one website's, or every website's in one
 * workspace. Either way the membership filter is in the query.
 */
export function listExperimentsForList(
  userId: string,
  scope: { websiteId: string } | { workspaceId: string },
  client: DbClient = db,
): Promise<ListedExperiment[]> {
  return client.experiment.findMany({
    where:
      "websiteId" in scope
        ? { websiteId: scope.websiteId, ...experimentAccess(userId) }
        : experimentAccess(userId, { workspaceId: scope.workspaceId }),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: LIST_SELECT,
  });
}

export interface ArmCountMaps {
  assigned: Map<string | null, number>;
  converted: Map<string | null, number>;
}

/**
 * Assigned visitors and conversions per arm for many experiments — two grouped queries in total,
 * however many experiments are listed. Ids the user cannot see contribute nothing.
 */
export async function countArmsForExperiments(
  userId: string,
  experimentIds: readonly string[],
  client: DbClient = db,
): Promise<Map<string, ArmCountMaps>> {
  const out = new Map<string, ArmCountMaps>();
  if (experimentIds.length === 0) return out;

  const where = { experimentId: { in: [...experimentIds] }, experiment: experimentAccess(userId) };
  const [assignments, conversions] = await Promise.all([
    client.assignment.groupBy({
      by: ["experimentId", "variantId"],
      where,
      _count: { _all: true },
    }),
    client.conversion.groupBy({
      by: ["experimentId", "variantId"],
      where,
      _count: { _all: true },
    }),
  ]);

  const entry = (id: string): ArmCountMaps => {
    let e = out.get(id);
    if (!e) {
      e = { assigned: new Map(), converted: new Map() };
      out.set(id, e);
    }
    return e;
  };
  for (const row of assignments)
    entry(row.experimentId).assigned.set(row.variantId, row._count._all);
  for (const row of conversions) {
    entry(row.experimentId).converted.set(row.variantId, row._count._all);
  }
  return out;
}

/** The newest activity row of each experiment (for "Just now · by you"). */
export async function latestActivityByExperiment(
  userId: string,
  experimentIds: readonly string[],
  client: DbClient = db,
): Promise<Map<string, { actorId: string | null; createdAt: Date }>> {
  if (experimentIds.length === 0) return new Map();
  const rows = await client.experimentActivity.findMany({
    where: { experimentId: { in: [...experimentIds] }, experiment: experimentAccess(userId) },
    orderBy: [{ experimentId: "asc" }, { createdAt: "desc" }],
    distinct: ["experimentId"],
    select: { experimentId: true, actorId: true, createdAt: true },
  });
  return new Map(rows.map((row) => [row.experimentId, row]));
}

export interface ActivityRow {
  id: string;
  type: ExperimentActivityType;
  actorId: string | null;
  actorName: string | null;
  meta: Prisma.JsonValue;
  createdAt: Date;
}

/**
 * One experiment's activity log, oldest first, with each actor's display name. The caller has
 * authorized the experiment; the access filter is applied again here regardless.
 */
export async function listActivity(
  userId: string,
  experimentId: string,
  client: DbClient = db,
): Promise<ActivityRow[]> {
  const rows = await client.experimentActivity.findMany({
    where: { experimentId, experiment: experimentAccess(userId) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      type: true,
      actorId: true,
      meta: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
  return rows.map(({ actor, ...row }) => ({
    ...row,
    actorName: actor ? actor.name?.trim() || actor.email : null,
  }));
}

/** A user's display name — their name, or their email when they have none. */
export async function findDisplayName(
  userId: string,
  client: DbClient = db,
): Promise<string | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return user ? user.name?.trim() || user.email : null;
}

/** The latest RESUMED instant, for "Resumed just now". */
export async function latestResumedAt(
  experimentId: string,
  client: DbClient = db,
): Promise<Date | null> {
  const row = await client.experimentActivity.findFirst({
    where: { experimentId, type: "RESUMED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}
