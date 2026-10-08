import "server-only";

import type { Visitor } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for visitors.
 *
 * Every ingested batch begins here, so the hot path is a single upsert keyed on the
 * `(websiteId, anonymousId)` unique constraint. That constraint is what makes concurrent
 * requests from the same browser converge on one row instead of racing to insert duplicates.
 */

export function upsertVisitor(
  websiteId: string,
  anonymousId: string,
  seenAt: Date,
  client: DbClient = db,
): Promise<Visitor> {
  return client.visitor.upsert({
    where: { websiteId_anonymousId: { websiteId, anonymousId } },
    create: { websiteId, anonymousId, firstSeenAt: seenAt, lastSeenAt: seenAt },
    update: { lastSeenAt: seenAt },
  });
}

export function findVisitor(
  websiteId: string,
  anonymousId: string,
  client: DbClient = db,
): Promise<Visitor | null> {
  return client.visitor.findUnique({
    where: { websiteId_anonymousId: { websiteId, anonymousId } },
  });
}
