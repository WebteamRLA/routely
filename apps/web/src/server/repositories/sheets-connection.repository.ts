import "server-only";

import type { Prisma, SheetsConnection } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for a customer's Google Sheets connection.
 *
 * Same rule as every other repository: ownership-sensitive functions take `userId` and fold it
 * into the `where` clause, and writes use `updateMany`/`deleteMany` so the tenant filter
 * participates in the write itself rather than relying on a prior read.
 *
 * There is at most one connection per account (`SheetsConnection.userId` is unique), which is
 * why most functions here address it by `userId` rather than by its own id.
 *
 * This table holds the Google *grant* only. Where a website's rows are written lives in
 * `website-sheet-target.repository.ts` — one destination per website, so the two are deliberately
 * not the same record.
 *
 * Nothing here decrypts anything. The token columns are ciphertext in and ciphertext out — the
 * only module that holds the key is `server/crypto.ts`, and keeping that boundary means a query
 * logged in full still discloses nothing usable.
 */

export function findConnectionForUser(
  userId: string,
  client: DbClient = db,
): Promise<SheetsConnection | null> {
  return client.sheetsConnection.findUnique({ where: { userId } });
}

/**
 * Creates the connection, or updates the existing one in place.
 *
 * Upsert rather than delete-and-create, because reconnecting must **keep the destination and the
 * run history**. A customer whose token expired and who reconnects has not asked to re-sync days
 * already written — and losing the run rows would mean exactly that, silently, on the next sweep.
 */
export function upsertConnection(
  userId: string,
  data: {
    googleEmail: string | null;
    googleSubject: string | null;
    refreshTokenCipher: string;
    accessTokenCipher: string | null;
    accessTokenExpiresAt: Date | null;
    grantedScopes: string;
  },
  client: DbClient = db,
): Promise<SheetsConnection> {
  return client.sheetsConnection.upsert({
    where: { userId },
    create: { userId, ...data, status: "CONNECTED", statusDetail: null },
    update: {
      ...data,
      // A reconnect clears the failure that prompted it. The destination fields are deliberately
      // absent from this update, so they survive.
      status: "CONNECTED",
      statusDetail: null,
      connectedAt: new Date(),
    },
  });
}

/** Caches a freshly minted access token. Addressed by connection id — the caller already has it. */
export function storeAccessToken(
  connectionId: string,
  accessTokenCipher: string,
  expiresAt: Date,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.sheetsConnection.updateMany({
    where: { id: connectionId },
    data: { accessTokenCipher, accessTokenExpiresAt: expiresAt },
  });
}

/** Replaces the stored refresh token, for the rare case where Google rotates one. */
export function storeRefreshToken(
  connectionId: string,
  refreshTokenCipher: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.sheetsConnection.updateMany({
    where: { id: connectionId },
    data: { refreshTokenCipher },
  });
}

/**
 * Marks a connection as needing the customer's attention.
 *
 * The cached access token is cleared at the same time: it is useless once the refresh token is
 * refused, and leaving it would let a request appear to succeed until it happened to expire.
 */
export function markNeedsReconnect(
  connectionId: string,
  detail: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.sheetsConnection.updateMany({
    where: { id: connectionId },
    data: {
      status: "NEEDS_RECONNECT",
      statusDetail: detail,
      accessTokenCipher: null,
      accessTokenExpiresAt: null,
    },
  });
}

export function deleteConnectionForUser(
  userId: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  // Run rows cascade from the foreign key.
  return client.sheetsConnection.deleteMany({ where: { userId } });
}

/**
 * The grant for one website's owner, for the daily sweep.
 *
 * No `userId` argument, because the sweep acts for every account rather than on behalf of one
 * actor — the same shape as the ingestion-path repository functions. Which *websites* get synced is
 * decided by `website-sheet-target.repository.listSyncableTargets`; this only fetches the tokens
 * needed to write them, and returns null when the owner's grant is gone or broken.
 */
export function findConnectedGrant(
  userId: string,
  client: DbClient = db,
): Promise<SheetsConnection | null> {
  return client.sheetsConnection.findFirst({
    where: { userId, status: "CONNECTED" },
  });
}
