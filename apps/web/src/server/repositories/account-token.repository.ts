import "server-only";

import { type DbClient, db } from "@/server/db";

/**
 * Single-use tokens sent by email: email verification, password reset and email change.
 *
 * Only the SHA-256 of a token is ever stored — the raw value exists in the emailed link alone — so
 * a read of this database cannot be replayed into a reset or a takeover. Consumption is a
 * compare-and-set on "not yet used", so a link clicked twice (or by a mail scanner and then its
 * owner) is spent exactly once.
 */

// --- Email verification (reuses Auth.js's `verification_tokens`) ------------------------------

/** `identifier` namespace, so these rows can never collide with an Auth.js email-provider token. */
export const VERIFY_IDENTIFIER_PREFIX = "verify-email:";

export async function replaceVerificationToken(
  userId: string,
  tokenHash: string,
  expires: Date,
  client: DbClient = db,
): Promise<void> {
  const identifier = `${VERIFY_IDENTIFIER_PREFIX}${userId}`;
  await client.verificationToken.deleteMany({ where: { identifier } });
  await client.verificationToken.create({ data: { identifier, token: tokenHash, expires } });
}

/**
 * Deletes the token and returns the user id it was issued to, or null when it is unknown, expired
 * or already used. Deleting *is* the consumption, so exactly one caller gets the id.
 */
export async function consumeVerificationToken(
  tokenHash: string,
  now: Date,
  client: DbClient = db,
): Promise<string | null> {
  const row = await client.verificationToken.findFirst({
    where: { token: tokenHash, identifier: { startsWith: VERIFY_IDENTIFIER_PREFIX } },
  });
  if (!row) return null;
  const { count } = await client.verificationToken.deleteMany({
    where: { identifier: row.identifier, token: tokenHash },
  });
  if (count !== 1 || row.expires <= now) return null;
  return row.identifier.slice(VERIFY_IDENTIFIER_PREFIX.length);
}

/** The live link's user id, without spending it — the link page shows a button first. */
export async function peekVerificationToken(
  tokenHash: string,
  now: Date,
  client: DbClient = db,
): Promise<string | null> {
  const row = await client.verificationToken.findFirst({
    where: {
      token: tokenHash,
      identifier: { startsWith: VERIFY_IDENTIFIER_PREFIX },
      expires: { gt: now },
    },
  });
  return row ? row.identifier.slice(VERIFY_IDENTIFIER_PREFIX.length) : null;
}

/** Once the address is verified, by link or by code, the other one is void too. */
export async function clearVerification(userId: string, client: DbClient = db): Promise<void> {
  await client.verificationToken.deleteMany({
    where: { identifier: `${VERIFY_IDENTIFIER_PREFIX}${userId}` },
  });
  await client.emailVerificationCode.deleteMany({ where: { userId } });
}

// --- Email verification code -------------------------------------------------------------------

export async function replaceVerificationCode(
  userId: string,
  codeHash: string,
  expiresAt: Date,
  client: DbClient = db,
): Promise<void> {
  await client.emailVerificationCode.upsert({
    where: { userId },
    create: { userId, codeHash, expiresAt },
    update: { codeHash, expiresAt, attempts: 0, createdAt: new Date() },
  });
}

/** When the live code was sent, or null when there is none to type. */
export async function liveVerificationCode(
  userId: string,
  now: Date,
  maxAttempts: number,
  client: DbClient = db,
): Promise<{ createdAt: Date } | null> {
  return client.emailVerificationCode.findFirst({
    where: { userId, expiresAt: { gt: now }, attempts: { lt: maxAttempts } },
    select: { createdAt: true },
  });
}

/**
 * One guess at the code. The attempt is claimed first — an increment guarded by the limit — and
 * only then compared, so a burst of concurrent guesses cannot get past `maxAttempts`. A right
 * guess deletes the row (single use); `"spent"` means no code is left to guess against.
 */
export async function tryVerificationCode(
  userId: string,
  codeHash: string,
  now: Date,
  maxAttempts: number,
  client: DbClient = db,
): Promise<"ok" | "wrong" | "spent"> {
  const { count } = await client.emailVerificationCode.updateMany({
    where: { userId, expiresAt: { gt: now }, attempts: { lt: maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (count !== 1) return "spent";
  const { count: matched } = await client.emailVerificationCode.deleteMany({
    where: { userId, codeHash },
  });
  if (matched === 1) return "ok";
  const left = await liveVerificationCode(userId, now, maxAttempts, client);
  return left ? "wrong" : "spent";
}

// --- Password reset ----------------------------------------------------------------------------

export async function createPasswordReset(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
  client: DbClient = db,
): Promise<void> {
  await client.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
}

/** A reset token that can still be used, for showing the form. Does not consume it. */
export function findUsablePasswordReset(tokenHash: string, now: Date, client: DbClient = db) {
  return client.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  });
}

/** Marks the token used — compare-and-set, so only one submission wins. */
export async function consumePasswordReset(
  id: string,
  now: Date,
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.passwordResetToken.updateMany({
    where: { id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return count === 1;
}

/** After a successful reset every other outstanding link for the account is void. */
export async function invalidatePasswordResets(
  userId: string,
  now: Date,
  client: DbClient = db,
): Promise<void> {
  await client.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: now },
  });
}

// --- Email change ------------------------------------------------------------------------------

/** The live request — unconsumed and unexpired — that the profile banner shows. */
export function findPendingEmailChange(userId: string, now: Date, client: DbClient = db) {
  return client.emailChangeRequest.findFirst({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, newEmail: true },
  });
}

/** Supersedes any earlier request, then records this one. Run inside a transaction. */
export async function replaceEmailChange(
  userId: string,
  newEmail: string,
  tokenHash: string,
  expiresAt: Date,
  client: DbClient,
): Promise<void> {
  await client.emailChangeRequest.deleteMany({ where: { userId, consumedAt: null } });
  await client.emailChangeRequest.create({ data: { userId, newEmail, tokenHash, expiresAt } });
}

/** Rotates the link of the pending request (the old link stops working). */
export async function rotateEmailChange(
  userId: string,
  requestId: string,
  tokenHash: string,
  expiresAt: Date,
  client: DbClient = db,
): Promise<boolean> {
  const { count } = await client.emailChangeRequest.updateMany({
    where: { id: requestId, userId, consumedAt: null },
    data: { tokenHash, expiresAt },
  });
  return count === 1;
}

export async function cancelEmailChanges(userId: string, client: DbClient = db): Promise<number> {
  const { count } = await client.emailChangeRequest.deleteMany({
    where: { userId, consumedAt: null },
  });
  return count;
}

export function findEmailChangeByToken(tokenHash: string, client: DbClient = db) {
  return client.emailChangeRequest.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      newEmail: true,
      expiresAt: true,
      consumedAt: true,
      user: { select: { email: true, name: true } },
    },
  });
}

export async function consumeEmailChange(
  id: string,
  now: Date,
  client: DbClient,
): Promise<boolean> {
  const { count } = await client.emailChangeRequest.updateMany({
    where: { id, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  return count === 1;
}
