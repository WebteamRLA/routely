import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for custom event occurrences. Written only by ingestion; every read is by a website
 * the service has already authorized.
 */

export interface CustomEventInput {
  websiteId: string;
  name: string;
  eventKey: string;
  anonymousId: string;
  url: string;
  properties: Record<string, string | number | boolean> | null;
  occurredAt: Date;
}

/** True when this call stored it; false for a repeat, which the unique `eventKey` absorbs. */
export async function insertCustomEvent(
  { properties, ...input }: CustomEventInput,
  client: DbClient = db,
): Promise<boolean> {
  const result = await client.customEvent.createMany({
    data: [{ ...input, ...(properties ? { properties: properties as Prisma.JsonObject } : {}) }],
    skipDuplicates: true,
  });
  return result.count === 1;
}

/**
 * Whether occurrences of this name are kept: it is defined, it has arrived before, or the project
 * still has room for new unconfigured names.
 */
export async function nameAllowed(
  websiteId: string,
  name: string,
  maxUndeclared: number,
  client: DbClient = db,
): Promise<boolean> {
  const [defined, seen] = await Promise.all([
    client.eventDefinition.findUnique({
      where: { websiteId_name: { websiteId, name } },
      select: { id: true },
    }),
    client.customEvent.findFirst({ where: { websiteId, name }, select: { id: true } }),
  ]);
  if (defined || seen) return true;

  const names = await client.customEvent.findMany({
    where: { websiteId },
    distinct: ["name"],
    select: { name: true },
    take: maxUndeclared,
  });
  return names.length < maxUndeclared;
}

export interface EventNameSummary {
  name: string;
  total: number;
  lastReceivedAt: Date | null;
}

/** Totals per name for one project, served by the `(websiteId, name, occurredAt)` index. */
export async function summarizeByName(
  websiteId: string,
  client: DbClient = db,
): Promise<EventNameSummary[]> {
  const rows = await client.customEvent.groupBy({
    by: ["name"],
    where: { websiteId },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  return rows.map((row) => ({
    name: row.name,
    total: row._count._all,
    lastReceivedAt: row._max.occurredAt,
  }));
}
