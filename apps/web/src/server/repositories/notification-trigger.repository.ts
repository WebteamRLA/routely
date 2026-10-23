import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * System reads and latches behind the RESULT_READY and TRACKING_STOPPED notifications
 * (`server/jobs/*`).
 *
 * **Not tenant-scoped, deliberately.** No user is acting: these run after an anonymous beacon or
 * from the cron. Nothing read here is returned to anyone — the jobs hand a workspace id to
 * `notification.service`, which derives the recipients from membership itself.
 *
 * **Latches are compare-and-sets that restate the whole condition in their `WHERE`**, never a
 * read-then-write: a concurrent check, cron run or second process re-evaluates the row under its
 * lock and matches nothing. They are raw `UPDATE`s, like `touchLastSeen`, so that Prisma's
 * `@updatedAt` keeps meaning "a person edited this" — a system latch moving an experiment to the
 * top of a list sorted by last change would be a lie.
 */

// ---------------------------------------------------------------------------------------------
// RESULT_READY
// ---------------------------------------------------------------------------------------------

const RESULT_CANDIDATE_SELECT = {
  id: true,
  name: true,
  status: true,
  resultReadyAt: true,
  website: { select: { name: true, workspaceId: true } },
  variants: { orderBy: { position: "asc" as const }, select: { id: true, name: true } },
} satisfies Prisma.ExperimentSelect;

export type ResultReadyCandidate = Prisma.ExperimentGetPayload<{
  select: typeof RESULT_CANDIDATE_SELECT;
}>;

/**
 * ACTIVE experiments that have not announced a result yet — all of them (the cron), or only
 * `experimentIds` (a check after ingestion). Ordered by id so a truncated sweep resumes fairly.
 */
export function listResultReadyCandidates(
  experimentIds?: readonly string[],
  client: DbClient = db,
): Promise<ResultReadyCandidate[]> {
  return client.experiment.findMany({
    where: {
      status: "ACTIVE",
      resultReadyAt: null,
      ...(experimentIds ? { id: { in: [...experimentIds] } } : {}),
    },
    orderBy: { id: "asc" },
    select: RESULT_CANDIDATE_SELECT,
  });
}

export interface ArmTotals {
  /** count(assignments) per arm; `null` is control. */
  assigned: Map<string | null, number>;
  /** count(conversions) per arm. */
  converted: Map<string | null, number>;
}

/**
 * All-time assigned visitors and conversions per arm for several experiments — two grouped
 * queries in total, served by the `(experimentId, variantId)` indexes on both tables.
 */
export async function countArmTotals(
  experimentIds: readonly string[],
  client: DbClient = db,
): Promise<Map<string, ArmTotals>> {
  const out = new Map<string, ArmTotals>();
  if (experimentIds.length === 0) return out;

  const where = { experimentId: { in: [...experimentIds] } };
  const [assignments, conversions] = await Promise.all([
    client.assignment.groupBy({ by: ["experimentId", "variantId"], where, _count: { _all: true } }),
    client.conversion.groupBy({ by: ["experimentId", "variantId"], where, _count: { _all: true } }),
  ]);

  const entry = (experimentId: string): ArmTotals => {
    let totals = out.get(experimentId);
    if (!totals) {
      totals = { assigned: new Map(), converted: new Map() };
      out.set(experimentId, totals);
    }
    return totals;
  };

  for (const row of assignments) {
    entry(row.experimentId).assigned.set(row.variantId, row._count._all);
  }
  for (const row of conversions) {
    entry(row.experimentId).converted.set(row.variantId, row._count._all);
  }
  return out;
}

/**
 * Claims RESULT_READY for an experiment: `resultReadyAt IS NULL → now` while it is still ACTIVE,
 * and the system activity row, in one transaction. True for exactly one caller, however many
 * checks race — the losers' `UPDATE` re-evaluates the row after the winner commits and matches
 * nothing.
 *
 * The activity insert is `ON CONFLICT DO NOTHING` (`createMany` + `skipDuplicates`), so the
 * partial unique index `experiment_activities_result_once` is tolerated rather than tripped: a
 * row left by an earlier latch (say, one cleared by hand) must not roll the claim back and leave
 * the experiment re-announcing forever.
 */
export function claimResultReady(
  experimentId: string,
  now: Date,
  meta: Prisma.InputJsonValue,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.$executeRaw`
      UPDATE "experiments" SET "resultReadyAt" = ${now}
      WHERE "id" = ${experimentId} AND "status" = 'ACTIVE' AND "resultReadyAt" IS NULL
    `;
    if (claimed === 0) return false;

    await tx.experimentActivity.createMany({
      data: [{ experimentId, type: "RESULT_READY", actorId: null, meta, createdAt: now }],
      skipDuplicates: true,
    });
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// TRACKING_STOPPED
// ---------------------------------------------------------------------------------------------

/**
 * Websites that might need "Tracking stops": a hit before `cutoff`, at least one ACTIVE
 * experiment, and no alert since that hit. The job still decides with the pure
 * `trackingAlertDecision`; this only keeps the candidate list short.
 */
export function listTrackingAlertCandidates(cutoff: Date, client: DbClient = db) {
  return client.website.findMany({
    where: {
      lastSeenAt: { lt: cutoff },
      experiments: { some: { status: "ACTIVE" } },
      OR: [
        { trackingAlertSentAt: null },
        { trackingAlertSentAt: { lt: client.website.fields.lastSeenAt } },
      ],
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      domain: true,
      workspaceId: true,
      lastSeenAt: true,
      pixelVerifiedAt: true,
      trackingAlertSentAt: true,
      _count: { select: { experiments: { where: { status: "ACTIVE" } } } },
    },
  });
}

export type TrackingAlertCandidate = Awaited<
  ReturnType<typeof listTrackingAlertCandidates>
>[number];

/**
 * Claims "Tracking stops" for one website. The `WHERE` restates every condition of
 * `trackingAlertDecision`, evaluated by the database at the moment of the write:
 *
 * - the last hit is before `cutoff` — a hit since the job read the row moves `lastSeenAt` to now,
 *   past the cutoff, and the claim fails;
 * - no install check since `cutoff` either (the badge would read "Active");
 * - not already alerted since the last hit (the latch);
 * - an experiment is still ACTIVE.
 */
export async function claimTrackingAlert(
  websiteId: string,
  cutoff: Date,
  now: Date,
  client: DbClient = db,
): Promise<boolean> {
  const count = await client.$executeRaw`
    UPDATE "websites" SET "trackingAlertSentAt" = ${now}
    WHERE "id" = ${websiteId}
      AND "lastSeenAt" IS NOT NULL
      AND "lastSeenAt" < ${cutoff}
      AND ("pixelVerifiedAt" IS NULL OR "pixelVerifiedAt" < ${cutoff})
      AND ("trackingAlertSentAt" IS NULL OR "trackingAlertSentAt" < "lastSeenAt")
      AND EXISTS (
        SELECT 1 FROM "experiments" e
        WHERE e."websiteId" = "websites"."id" AND e."status" = 'ACTIVE'
      )
  `;
  return count > 0;
}

/**
 * Clears the latch on every website that has received a hit since its alert. Housekeeping: the
 * latch condition (`trackingAlertSentAt < lastSeenAt` re-arms) already works without it, but a
 * cleared column reads plainly as "no alert outstanding". Returns how many were re-armed.
 */
export function rearmTrackingAlerts(client: DbClient = db): Promise<number> {
  return client.$executeRaw`
    UPDATE "websites" SET "trackingAlertSentAt" = NULL
    WHERE "trackingAlertSentAt" IS NOT NULL AND "lastSeenAt" > "trackingAlertSentAt"
  `;
}
