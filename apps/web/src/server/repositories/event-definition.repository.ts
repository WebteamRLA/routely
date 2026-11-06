import "server-only";

import type { EventDefinition, MemberRole, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { websiteAccess } from "@/server/repositories/access";

/**
 * Data access for a project's event definitions. Writes fold the actor's membership and roles into
 * the `where`, as every tenant-sensitive write here does. The public paths (`listTriggers`,
 * `clearIssue`, `reportIssue`) take a website id the ingestion service resolved from the site id.
 */

export type EventDefinitionWithUsage = Prisma.EventDefinitionGetPayload<{
  include: { experiments: { select: { id: true; name: true; status: true; type: true } } };
}>;

export function listDefinitions(
  websiteId: string,
  client: DbClient = db,
): Promise<EventDefinitionWithUsage[]> {
  return client.eventDefinition.findMany({
    where: { websiteId },
    orderBy: { createdAt: "desc" },
    include: { experiments: { select: { id: true, name: true, status: true, type: true } } },
  });
}

export function findDefinition(
  id: string,
  userId: string,
  client: DbClient = db,
): Promise<EventDefinitionWithUsage | null> {
  return client.eventDefinition.findFirst({
    where: { id, website: websiteAccess(userId) },
    include: { experiments: { select: { id: true, name: true, status: true, type: true } } },
  });
}

/** The one event an experiment on this website may use, or null. */
export function findInWebsite(
  id: string,
  websiteId: string,
  client: DbClient = db,
): Promise<Pick<EventDefinition, "id"> | null> {
  return client.eventDefinition.findFirst({ where: { id, websiteId }, select: { id: true } });
}

export function createDefinition(
  data: Prisma.EventDefinitionUncheckedCreateInput,
  client: DbClient = db,
): Promise<EventDefinition> {
  return client.eventDefinition.create({ data });
}

export function updateDefinition(
  id: string,
  userId: string,
  roles: readonly MemberRole[],
  data: Prisma.EventDefinitionUncheckedUpdateManyInput,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.eventDefinition.updateMany({
    where: { id, website: websiteAccess(userId, { roles }) },
    data,
  });
}

export function deleteDefinition(
  id: string,
  userId: string,
  roles: readonly MemberRole[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.eventDefinition.deleteMany({
    where: { id, website: websiteAccess(userId, { roles }) },
  });
}

/** Definitions the SDK needs: those with something to listen for. */
export function listTriggers(websiteId: string, client: DbClient = db) {
  return client.eventDefinition.findMany({
    where: { websiteId, method: { not: "CODE" } },
    orderBy: { createdAt: "asc" },
    select: {
      name: true,
      method: true,
      selector: true,
      pageUrl: true,
      pageMatch: true,
      formSuccess: true,
      successUrl: true,
      successMatch: true,
      successSelector: true,
      successEvent: true,
      issueCode: true,
    },
  });
}

/** An occurrence arrived, so an earlier problem report no longer stands. Writes only if one does. */
export function clearIssue(
  websiteId: string,
  name: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.eventDefinition.updateMany({
    where: { websiteId, name, issueCode: { not: null } },
    data: { issueCode: null, issueUrl: null, issueAt: null },
  });
}

/**
 * Records what the SDK saw on a page. Only an existing definition can carry a problem, and a
 * repeat of the standing problem writes nothing, so a busy broken page costs no writes.
 */
export function reportIssue(
  websiteId: string,
  name: string,
  code: "selector_missing" | "selector_ok" | "form_ajax",
  url: string,
  at: Date,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  if (code === "selector_ok") {
    return client.eventDefinition.updateMany({
      where: { websiteId, name, issueCode: "selector_missing" },
      data: { issueCode: null, issueUrl: null, issueAt: null },
    });
  }
  return client.eventDefinition.updateMany({
    where: { websiteId, name, OR: [{ issueCode: null }, { issueCode: { not: code } }] },
    data: { issueCode: code, issueUrl: url, issueAt: at },
  });
}
