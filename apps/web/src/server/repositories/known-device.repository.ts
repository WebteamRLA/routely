import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * (browser, OS, country) combinations a user has signed in from, for the "New sign-in" email.
 * Kept apart from `sessions` because sessions are deleted at sign-out and would lose the history.
 */

export function countKnownDevices(userId: string, client: DbClient = db): Promise<number> {
  return client.knownSignInDevice.count({ where: { userId } });
}

/**
 * Records the fingerprint. True when it was **new** for this user; an already-known one only has
 * its `lastSeenAt` refreshed. Concurrent first sign-ins from the same device resolve to one row
 * and one "new" — the primary key decides.
 */
export async function rememberDevice(
  userId: string,
  fingerprintHash: string,
  now: Date,
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.knownSignInDevice.updateMany({
    where: { userId, fingerprintHash },
    data: { lastSeenAt: now },
  });
  if (count > 0) return false;
  try {
    await client.knownSignInDevice.create({
      data: { userId, fingerprintHash, firstSeenAt: now, lastSeenAt: now },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}
