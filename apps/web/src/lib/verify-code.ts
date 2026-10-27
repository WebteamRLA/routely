import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Email verification by code — the pure half (`server/auth/verify-cookie.ts` and
 * `account.service.ts` hold the configured halves).
 *
 * A new password account is not signed in until it proves its inbox, either by following the
 * emailed link or by typing the six-digit code from the same email on `/verify-email`. The code is
 * short enough to type, so two things keep it from being guessed:
 *
 * - **Only a browser that knew the password may type it.** Sign-up and a password sign-in to an
 *   unverified account set the *pending* cookie: the user id, an expiry and an HMAC over both. The
 *   code page reads the account from that cookie, never from the form, so a stranger who only knows
 *   someone's email has nowhere to type a guess.
 * - **Five guesses per code**, counted in the database before each comparison
 *   (`MAX_CODE_ATTEMPTS`), then a new code has to be sent.
 */

export const CODE_LENGTH = 6;
export const MAX_CODE_ATTEMPTS = 5;

/** A uniformly random six-digit code, leading zeros kept. */
export function newVerificationCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Digits only — people paste "123 456" or "123-456". Null unless exactly six remain. */
export function normalizeCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** Stored instead of the code. Salted with the user id so equal codes hash differently. */
export function hashVerificationCode(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

// --- The pending cookie ------------------------------------------------------------------------

/** Separate from every other use of `AUTH_SECRET`, like the editor token's key. */
export function derivePendingKey(authSecret: string): Buffer {
  return createHmac("sha256", authSecret).update("routely/verify-pending/v1").digest();
}

function mac(body: string, key: Buffer): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

/** `<userId>.<expiresAtSeconds>.<hmac>`. */
export function signPending(userId: string, expiresAt: Date, key: Buffer): string {
  const body = `${userId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${body}.${mac(body, key)}`;
}

/** The user id, or null when the value is malformed, forged or expired. */
export function readPending(value: string | undefined, key: Buffer, now: Date): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, given] = parts as [string, string, string];
  if (!/^[\w-]{1,64}$/.test(userId) || !/^\d{1,12}$/.test(exp)) return null;

  const expected = Buffer.from(mac(`${userId}.${exp}`, key));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Number(exp) * 1000 <= now.getTime()) return null;
  return userId;
}
