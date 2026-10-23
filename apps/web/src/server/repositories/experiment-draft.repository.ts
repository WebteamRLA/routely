import "server-only";

import type { Experiment, ExperimentStatus, MemberRole, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { experimentAccess } from "@/server/repositories/access";

/**
 * Writes behind the new-design wizards and the lifecycle (draft → running → paused → ended).
 *
 * Every write carries the tenant filter *and* the status it is allowed from in its own `where`,
 * so a concurrent launch, pause or second tab cannot slip a change past the rule that was
 * checked a moment earlier: the write simply matches nothing, and the service reports why.
 * None of these opens a transaction; `experiment.service` composes them, with the activity row,
 * inside one.
 */

/**
 * Serialises launches and resumes on one website for the rest of the transaction.
 *
 * "One running experiment per page" is a read (who is running?) followed by a write (now this one
 * is). Two launches on the same page at the same moment would both read "nobody" without a lock;
 * with it, the second waits, then re-reads and sees the first. A transaction-scoped advisory lock
 * keyed on the website: released on commit or rollback, contended only by launches on the same
 * site.
 */
export async function lockWebsiteForLaunch(websiteId: string, client: DbClient): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`routely:launch:${websiteId}`}, 0))`;
}

export function createDraftExperiment(
  data: Prisma.ExperimentUncheckedCreateInput,
  client: DbClient = db,
): Promise<Experiment> {
  return client.experiment.create({ data });
}

/**
 * Updates a draft's own fields. Matches nothing unless the experiment is still a DRAFT, the
 * actor holds one of `roles` in its workspace, and — when given — it has not been saved since
 * `unchangedSince`.
 */
export function updateExperimentWhere(
  experimentId: string,
  userId: string,
  roles: readonly MemberRole[],
  where: { status: ExperimentStatus | readonly ExperimentStatus[]; updatedAt?: Date },
  data: Prisma.ExperimentUpdateManyMutationInput,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  const status = typeof where.status === "string" ? where.status : { in: [...where.status] };
  return client.experiment.updateMany({
    where: {
      id: experimentId,
      status,
      ...(where.updatedAt ? { updatedAt: where.updatedAt } : {}),
      ...experimentAccess(userId, { roles }),
    },
    data,
  });
}

/** The ids of an experiment's variants. The caller has already authorized the experiment. */
export async function listVariantIds(
  experimentId: string,
  client: DbClient = db,
): Promise<string[]> {
  const rows = await client.experimentVariant.findMany({
    where: { experimentId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export function deleteVariants(
  experimentId: string,
  variantIds: readonly string[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.experimentVariant.deleteMany({
    where: { experimentId, id: { in: [...variantIds] } },
  });
}

/** Updates one variant — only if it belongs to `experimentId`. */
export function updateVariant(
  experimentId: string,
  variantId: string,
  data: Prisma.ExperimentVariantUpdateManyMutationInput,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.experimentVariant.updateMany({
    where: { id: variantId, experimentId },
    data,
  });
}

export function createVariant(
  data: Prisma.ExperimentVariantUncheckedCreateInput,
  client: DbClient = db,
): Promise<{ id: string }> {
  return client.experimentVariant.create({ data, select: { id: true } });
}

/** The current status of an experiment the actor can see, or null. */
export async function findStatus(
  experimentId: string,
  userId: string,
  client: DbClient = db,
): Promise<ExperimentStatus | null> {
  const row = await client.experiment.findFirst({
    where: { id: experimentId, ...experimentAccess(userId) },
    select: { status: true },
  });
  return row?.status ?? null;
}

/** A user's display name, for "Paused by …" in notification emails. */
export async function findUserName(userId: string, client: DbClient = db): Promise<string | null> {
  const row = await client.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return row?.name ?? row?.email ?? null;
}
