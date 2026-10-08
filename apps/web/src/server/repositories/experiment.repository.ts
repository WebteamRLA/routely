import "server-only";

import type { Experiment, ExperimentStatus, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for experiments.
 *
 * Ownership is expressed one level up, through the parent website: `website: { userId }`
 * scopes a query to the signed-in user without the experiment table needing a userId column.
 */

const VARIANTS_INCLUDE = {
  variants: { orderBy: { position: "asc" as const } },
} satisfies Prisma.ExperimentInclude;

export type ExperimentWithVariants = Prisma.ExperimentGetPayload<{
  include: typeof VARIANTS_INCLUDE;
}>;

export type ExperimentWithWebsite = Prisma.ExperimentGetPayload<{
  include: { website: true } & typeof VARIANTS_INCLUDE;
}>;

export function findExperimentForUser(
  experimentId: string,
  userId: string,
  client: DbClient = db,
): Promise<ExperimentWithWebsite | null> {
  return client.experiment.findFirst({
    where: { id: experimentId, website: { userId } },
    include: { website: true, ...VARIANTS_INCLUDE },
  });
}

/**
 * Active experiments on a website, optionally ignoring one.
 *
 * Used for conflict detection: `excludeId` lets an experiment be checked against its peers
 * without matching itself when it is already active and being re-validated.
 */
export function listActiveExperimentsExcluding(
  websiteId: string,
  excludeId: string | undefined,
  client: DbClient = db,
): Promise<Experiment[]> {
  return client.experiment.findMany({
    where: {
      websiteId,
      status: "ACTIVE",
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/**
 * Resolves an experiment by its public share token.
 *
 * Unscoped by user by design — the token is the credential. It is looked up on a unique index,
 * so an invalid token costs one index probe and reveals nothing.
 */
export function findExperimentByShareToken(
  shareToken: string,
  client: DbClient = db,
): Promise<ExperimentWithWebsite | null> {
  return client.experiment.findUnique({
    where: { shareToken },
    include: { website: true, ...VARIANTS_INCLUDE },
  });
}

export function createExperiment(
  data: Prisma.ExperimentUncheckedCreateInput,
  client: DbClient = db,
): Promise<Experiment> {
  return client.experiment.create({ data });
}

export function updateExperiment(
  experimentId: string,
  userId: string,
  data: Prisma.ExperimentUpdateManyArgs["data"],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.experiment.updateMany({
    where: { id: experimentId, website: { userId } },
    data,
  });
}

/**
 * Reconciles an experiment's variant rows with a submitted list: existing rows missing from
 * `variants` are deleted, existing rows present are updated (url and position), and entries
 * without an id are created.
 *
 * Deliberately does not open its own transaction — `DbClient` omits `$transaction` precisely so
 * a caller (the service layer) composes this with the experiment's own field update atomically,
 * rather than this repository function deciding transaction boundaries on its own.
 */
export async function replaceVariants(
  experimentId: string,
  variants: { id?: string; url: string; weight: number; changes?: Prisma.InputJsonValue }[],
  client: DbClient = db,
): Promise<void> {
  const existing = await client.experimentVariant.findMany({
    where: { experimentId },
    select: { id: true },
  });
  const submittedIds = new Set(variants.flatMap((variant) => (variant.id ? [variant.id] : [])));
  const toDelete = existing.map((row) => row.id).filter((id) => !submittedIds.has(id));

  if (toDelete.length > 0) {
    await client.experimentVariant.deleteMany({ where: { id: { in: toDelete } } });
  }

  for (const [index, variant] of variants.entries()) {
    const position = index + 1;
    const changes = variant.changes !== undefined ? { changes: variant.changes } : {};
    // Only ids that already belong to this experiment are updated; any other id (stale, or
    // forged in a form body) is treated as a new arm rather than touching someone else's row.
    if (variant.id && existing.some((row) => row.id === variant.id)) {
      await client.experimentVariant.update({
        where: { id: variant.id },
        data: { url: variant.url, weight: variant.weight, position, ...changes },
      });
    } else {
      await client.experimentVariant.create({
        data: { experimentId, url: variant.url, weight: variant.weight, position, ...changes },
      });
    }
  }
}

export function deleteExperiment(
  experimentId: string,
  userId: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.experiment.deleteMany({
    where: { id: experimentId, website: { userId } },
  });
}

/** One experiment, scoped to a project *and* its owner. */
export function findExperimentInProject(
  experimentId: string,
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<ExperimentWithWebsite | null> {
  return client.experiment.findFirst({
    where: { id: experimentId, websiteId, website: { userId } },
    include: { website: true, ...VARIANTS_INCLUDE },
  });
}

export interface ProjectExperimentQuery {
  status?: ExperimentStatus;
  type?: Experiment["type"];
  /** Case-insensitive substring of the name or URL. */
  search?: string;
}

/** A project's experiments, newest first, with variants. */
export function listExperimentsForProject(
  websiteId: string,
  userId: string,
  query: ProjectExperimentQuery = {},
  client: DbClient = db,
): Promise<ExperimentWithVariants[]> {
  const search = query.search?.trim();
  return client.experiment.findMany({
    where: {
      websiteId,
      website: { userId },
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { controlUrl: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: VARIANTS_INCLUDE,
  });
}

/** Experiment counts per website and status for one user. */
export async function countExperimentsByWebsiteAndStatus(
  userId: string,
  client: DbClient = db,
): Promise<Map<string, Record<ExperimentStatus, number>>> {
  const rows = await client.experiment.groupBy({
    by: ["websiteId", "status"],
    where: { website: { userId } },
    _count: { _all: true },
  });
  const totals = new Map<string, Record<ExperimentStatus, number>>();
  for (const row of rows) {
    const entry = totals.get(row.websiteId) ?? { DRAFT: 0, ACTIVE: 0, PAUSED: 0, ARCHIVED: 0 };
    entry[row.status] += row._count._all;
    totals.set(row.websiteId, entry);
  }
  return totals;
}
