import "server-only";

import type { Assignment } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for assignments — the binding of a visitor to one arm of one experiment.
 *
 * `variantId` is nullable: `null` is the control arm (no redirect target), a non-null value
 * references a specific `ExperimentVariant` row. See schema.prisma's header comment for why
 * control isn't a row of its own.
 */

/**
 * Returns the visitor's existing assignment, or creates it with the proposed arm.
 *
 * The upsert's `update` is deliberately a no-op on `variantId`: once a visitor is bucketed the
 * arm is permanent. If a client ever reports a different arm — a cleared cache, a stale tab, a
 * tampered payload — the stored arm wins, so a visitor's history can never be split across two
 * arms of the same experiment.
 */
export function ensureAssignment(
  experimentId: string,
  visitorId: string,
  variantId: string | null,
  assignedAt: Date,
  client: DbClient = db,
): Promise<Assignment> {
  return client.assignment.upsert({
    where: { experimentId_visitorId: { experimentId, visitorId } },
    create: { experimentId, visitorId, variantId, assignedAt },
    update: {},
  });
}

export function findAssignment(
  experimentId: string,
  visitorId: string,
  client: DbClient = db,
): Promise<Assignment | null> {
  return client.assignment.findUnique({
    where: { experimentId_visitorId: { experimentId, visitorId } },
  });
}

/**
 * The visitor's assignments in this website's **running** experiments, with each experiment's
 * goals — what a `page` or `track` event is matched against to derive conversions. Only
 * assignments that already exist: a conversion never creates one.
 */
export function listActiveAssignmentsForVisitor(
  visitorId: string,
  websiteId: string,
  client: DbClient = db,
) {
  return client.assignment.findMany({
    where: { visitorId, experiment: { websiteId, status: "ACTIVE" } },
    select: {
      id: true,
      experimentId: true,
      variantId: true,
      experiment: {
        select: {
          goalMetricId: true,
          conversionUrl: true,
          conversionMatchType: true,
          secondaryMetricIds: true,
        },
      },
    },
  });
}
