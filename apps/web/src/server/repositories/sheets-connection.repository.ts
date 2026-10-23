import "server-only";

import type { MemberRole, Prisma, SheetsConnection } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { workspaceAccess } from "@/server/repositories/access";

/**
 * Data access for a customer's Google Sheets connection.
 *
 * Same rule as every other repository: tenant-sensitive functions take the actor's `userId` and
 * fold a workspace-membership filter into the `where` clause, and writes use
 * `updateMany`/`deleteMany` so the tenant filter participates in the write itself rather than
 * relying on a prior read.
 *
 * There is at most one connection per workspace (`SheetsConnection.workspaceId` is unique), which
 * is why most functions here address it by workspace rather than by its own id.
 *
 * This table holds the Google *grant* only. Where a website's rows are written lives in
 * `website-sheet-target.repository.ts` — one destination per website, so the two are deliberately
 * not the same record.
 *
 * Nothing here decrypts anything. The token columns are ciphertext in and ciphertext out — the
 * only module that holds the key is `server/crypto.ts`, and keeping that boundary means a query
 * logged in full still discloses nothing usable.
 */

/** The workspace's grant — only when `userId` is a member of that workspace. */
export function findConnectionForWorkspace(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<SheetsConnection | null> {
  return client.sheetsConnection.findFirst({
    where: { workspaceId, workspace: workspaceAccess(userId) },
  });
}

/**
 * Creates the connection, or updates the existing one in place.
 *
 * Upsert rather than delete-and-create, so a reconnect (an expired token, say) is one write that
 * replaces the tokens in place — never a moment with no connection for a concurrent refresh to
 * trip over. Each website's spreadsheet lives in its own table and is not touched here.
 */
export function upsertConnection(
  workspaceId: string,
  connectedById: string,
  data: {
    googleName?: string | null;
    googlePicture?: string | null;
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
    where: { workspaceId },
    create: { workspaceId, connectedById, ...data, status: "CONNECTED", statusDetail: null },
    update: {
      ...data,
      // Whoever reconnects becomes the connector: the Picker runs on their Google account now.
      connectedById,
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

export function deleteConnectionForWorkspace(
  workspaceId: string,
  userId: string,
  roles: readonly MemberRole[],
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.sheetsConnection.deleteMany({
    where: { workspaceId, workspace: workspaceAccess(userId, { roles }) },
  });
}

/**
 * The grant of one website's workspace, for the refresh.
 *
 * No `userId` argument, because the refresh acts for the website rather than on behalf of an
 * actor — the same shape as the ingestion-path repository functions. Which *websites* get synced is
 * decided by `website-sheet-target.repository.listSyncableTargets`; this only fetches the tokens
 * needed to write them, and returns null when the workspace's grant is gone or broken.
 */
export function findConnectedGrant(
  workspaceId: string,
  client: DbClient = db,
): Promise<SheetsConnection | null> {
  return client.sheetsConnection.findFirst({
    where: { workspaceId, status: "CONNECTED" },
  });
}

/** The workspace's display name, only when `userId` is a member. For the connected toast. */
export async function findWorkspaceName(
  workspaceId: string,
  userId: string,
  client: DbClient = db,
): Promise<string | null> {
  const workspace = await client.workspace.findFirst({
    where: { id: workspaceId, ...workspaceAccess(userId) },
    select: { name: true },
  });

  return workspace?.name ?? null;
}
