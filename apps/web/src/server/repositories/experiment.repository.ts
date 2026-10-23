import "server-only";

import type { Experiment, ExperimentStatus, MemberRole, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { actorMembershipSelect, experimentAccess } from "@/server/repositories/access";

/**
 * Data access for experiments.
 *
 * Tenancy is expressed two levels up, through the website's workspace: `experimentAccess(userId)`
 * matches only experiments in a workspace the user is a member of, without the experiment table
 * needing a tenant column of its own. Writes also take the roles allowed to make them.
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

export function listExperimentsForWebsite(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Experiment[]> {
  return client.experiment.findMany({
    where: { websiteId, ...experimentAccess(userId) },
    orderBy: { createdAt: "desc" },
  });
}

/** An experiment in any workspace the user belongs to. */
export function findExperimentForUser(
  experimentId: string,
  userId: string,
  client: DbClient = db,
): Promise<ExperimentWithWebsite | null> {
  return client.experiment.findFirst({
    where: { id: experimentId, ...experimentAccess(userId) },
    include: { website: true, ...VARIANTS_INCLUDE },
  });
}

/**
 * An experiment the user can see, with the role they hold in its workspace — so the service can
 * tell NOT_FOUND (not a member) from FORBIDDEN (a member without the role).
 */
export async function findExperimentAccess(
  experimentId: string,
  userId: string,
  client: DbClient = db,
): Promise<{ experiment: ExperimentWithWebsite; role: MemberRole } | null> {
  const row = await client.experiment.findFirst({
    where: { id: experimentId, ...experimentAccess(userId) },
    include: {
      website: { include: { workspace: { select: actorMembershipSelect(userId) } } },
      ...VARIANTS_INCLUDE,
    },
  });

  const role = row?.website.workspace.memberships[0]?.role;
  if (!row || !role) return null;

  const { workspace: _workspace, ...website } = row.website;
  return { experiment: { ...row, website }, role };
}

/**
 * Active experiments for one website, as published to the browser by the config endpoint.
 * Deliberately keyed on the website id resolved from a public site id, never on a user.
 */
export function listActiveExperiments(
  websiteId: string,
  client: DbClient = db,
): Promise<ExperimentWithVariants[]> {
  return client.experiment.findMany({
    where: { websiteId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: VARIANTS_INCLUDE,
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
 * Resolves an experiment during ingestion, confirming it belongs to the reporting website.
 * Includes variants so the caller can verify a claimed variant id actually belongs to this
 * experiment before trusting it.
 */
export function findActiveExperimentForWebsite(
  experimentId: string,
  websiteId: string,
  client: DbClient = db,
): Promise<ExperimentWithVariants | null> {
  return client.experiment.findFirst({
    where: { id: experimentId, websiteId, status: "ACTIVE" },
    include: VARIANTS_INCLUDE,
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

export interface ExperimentQuery {
  status?: ExperimentStatus;
  /** Case-insensitive substring match on the name. */
  search?: string;
}

/**
 * Every experiment in one workspace, across all its websites, newest first — only if `userId` is a
 * member of it.
 *
 * Filtering happens in the query rather than in memory: a customer with many experiments
 * should not transfer all of them to render a filtered list, and the `[websiteId, createdAt]`
 * index keeps the ordering cheap.
 */
export function listExperimentsInWorkspace(
  workspaceId: string,
  userId: string,
  query: ExperimentQuery = {},
  client: DbClient = db,
): Promise<ExperimentWithWebsite[]> {
  return client.experiment.findMany({
    where: {
      ...experimentAccess(userId, { workspaceId }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { website: true, ...VARIANTS_INCLUDE },
  });
}

/** How many experiments the workspace has in each status, for the tab counts. */
export async function countExperimentsByStatus(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<Record<ExperimentStatus, number>> {
  const rows = await client.experiment.groupBy({
    by: ["status"],
    where: experimentAccess(userId, { workspaceId }),
    _count: { _all: true },
  });

  const totals: Record<ExperimentStatus, number> = {
    DRAFT: 0,
    ACTIVE: 0,
    PAUSED: 0,
    COMPLETED: 0,
  };
  for (const row of rows) {
    totals[row.status] = row._count._all;
  }
  return totals;
}

/**
 * Experiment counts per website for one user, split into total and currently running.
 *
 * One grouped query covering every website at once, rather than a count per row: the Get
 * started table lists them all, and a per-row query would scale with how many websites an
 * account has.
 */
export async function countExperimentsByWebsite(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<Map<string, { total: number; active: number }>> {
  const rows = await client.experiment.groupBy({
    by: ["websiteId", "status"],
    where: experimentAccess(userId, { workspaceId }),
    _count: { _all: true },
  });

  const totals = new Map<string, { total: number; active: number }>();

  for (const row of rows) {
    const entry = totals.get(row.websiteId) ?? { total: 0, active: 0 };
    entry.total += row._count._all;
    if (row.status === "ACTIVE") entry.active += row._count._all;
    totals.set(row.websiteId, entry);
  }

  return totals;
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
  roles: readonly MemberRole[],
  data: Prisma.ExperimentUpdateManyMutationInput,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.experiment.updateMany({
    where: { id: experimentId, ...experimentAccess(userId, { roles }) },
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
  variants: { id?: string; url: string; weight: number }[],
  client: DbClient = db,
): Promise<void> {
  const existing = await client.experimentVariant.findMany({
    where: { experimentId },
    select: { id: true, colorIndex: true },
  });
  const submittedIds = new Set(variants.flatMap((variant) => (variant.id ? [variant.id] : [])));
  const toDelete = existing.map((row) => row.id).filter((id) => !submittedIds.has(id));

  if (toDelete.length > 0) {
    await client.experimentVariant.deleteMany({ where: { id: { in: toDelete } } });
  }

  // Kept variants keep their colour and name; a new one takes the first free slot.
  const usedSlots = new Set(
    existing.filter((row) => submittedIds.has(row.id)).map((row) => row.colorIndex),
  );

  for (const [index, variant] of variants.entries()) {
    const position = index + 1;
    if (variant.id) {
      await client.experimentVariant.update({
        where: { id: variant.id },
        data: { url: variant.url, weight: variant.weight, position },
      });
    } else {
      const slot = firstFreeSlot(usedSlots, position);
      usedSlots.add(slot);
      await client.experimentVariant.create({
        data: {
          experimentId,
          url: variant.url,
          weight: variant.weight,
          position,
          colorIndex: slot,
          name: defaultVariantName(slot),
        },
      });
    }
  }
}

/** Colour slots run 1–4 — one per variant the product allows. */
const VARIANT_SLOTS = 4;

/** The lowest colour slot not taken, or a position-derived one past the four the UI offers. */
export function firstFreeSlot(used: ReadonlySet<number>, position: number): number {
  for (let slot = 1; slot <= VARIANT_SLOTS; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return ((position - 1) % VARIANT_SLOTS) + 1;
}

/** "Variant A" for slot 1, "Variant B" for slot 2, … */
export function defaultVariantName(slot: number): string {
  return `Variant ${String.fromCharCode(64 + Math.min(Math.max(slot, 1), 26))}`;
}

/**
 * Deletes an experiment. `status` is the status the caller's role decision was made for: it joins
 * the filter, so an Editor allowed to delete a *draft* matches nothing if the experiment was
 * launched in the meantime.
 */
export function deleteExperiment(
  experimentId: string,
  userId: string,
  roles: readonly MemberRole[],
  status?: ExperimentStatus,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.experiment.deleteMany({
    where: {
      id: experimentId,
      ...(status ? { status } : {}),
      ...experimentAccess(userId, { roles }),
    },
  });
}
