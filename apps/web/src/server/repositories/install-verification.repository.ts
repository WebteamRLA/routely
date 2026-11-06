import "server-only";

import type { InstallMethod, InstallVerification, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { websiteAccess } from "@/server/repositories/access";

/**
 * Data access for install checks. Reads for the dashboard go through the actor's membership;
 * `findByTokenHash` and the latches serve the public signal, whose token is the credential.
 */

export function createVerification(
  data: Prisma.InstallVerificationUncheckedCreateInput,
  client: DbClient = db,
): Promise<InstallVerification> {
  return client.installVerification.create({ data });
}

export function findForActor(
  id: string,
  userId: string,
  client: DbClient = db,
): Promise<InstallVerification | null> {
  return client.installVerification.findFirst({
    where: { id, website: websiteAccess(userId) },
  });
}

export function findByTokenHash(tokenHash: string, client: DbClient = db) {
  return client.installVerification.findUnique({
    where: { tokenHash },
    include: { website: { select: { id: true, domain: true, publicSiteId: true } } },
  });
}

/** Compare-and-set: the first signal of a stage wins, so a repeat changes nothing. */
export function latchLoaded(id: string, at: Date, client: DbClient = db) {
  return client.installVerification.updateMany({
    where: { id, loadedAt: null },
    data: { loadedAt: at },
  });
}

/** True for the signal that verified this run. */
export async function latchReady(id: string, at: Date, client: DbClient = db): Promise<boolean> {
  const { count } = await client.installVerification.updateMany({
    where: { id, readyAt: null },
    data: { readyAt: at, failReason: null },
  });
  return count === 1;
}

/** Only while unverified: a failure cannot take back a run that succeeded. */
export function recordFailure(id: string, reason: string, client: DbClient = db) {
  return client.installVerification.updateMany({
    where: { id, readyAt: null },
    data: { failReason: reason },
  });
}

export function recordPageFacts(
  id: string,
  facts: { otherSiteIds: string[]; tagCount: number; sdkVersion: string | null },
  client: DbClient = db,
) {
  return client.installVerification.update({ where: { id }, data: facts });
}

export function recordInstalled(
  websiteId: string,
  method: InstallMethod,
  at: Date,
  client: DbClient = db,
) {
  return client.website.update({
    where: { id: websiteId },
    data: { pixelVerifiedAt: at, installMethod: method },
  });
}

export async function pruneExpiredVerifications(now: Date, client: DbClient = db): Promise<number> {
  const { count } = await client.installVerification.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}
