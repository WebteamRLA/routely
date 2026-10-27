import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { env } from "@/env";
import { derivePendingKey, readPending, signPending } from "@/lib/verify-code";
import { getSession } from "@/server/auth/session";

/**
 * The pending-verification cookie (`lib/verify-code.ts` has the format and the reasoning): which
 * account this browser may type a verification code for. Set by sign-up and by a password sign-in
 * to an unverified account, cleared once the account is verified. It signs nobody in.
 *
 * Its key is derived from `AUTH_SECRET` under its own label; with no secret (development only —
 * `env.ts` requires one in production) a random key lasts for the life of the process.
 */
export const VERIFY_COOKIE = "routely-verify";
const MAX_AGE_S = 24 * 60 * 60;

let processKey: Buffer | null = null;

function key(): Buffer {
  if (env.AUTH_SECRET) return derivePendingKey(env.AUTH_SECRET);
  processKey ??= randomBytes(32);
  return processKey;
}

/** Server Actions only — cookies cannot be written during render. */
export async function setPendingVerification(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(VERIFY_COOKIE, signPending(userId, new Date(Date.now() + MAX_AGE_S * 1000), key()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** The account this browser is verifying, or null. */
export async function pendingVerificationUser(): Promise<string | null> {
  const jar = await cookies();
  return readPending(jar.get(VERIFY_COOKIE)?.value, key(), new Date());
}

export async function clearPendingVerification(): Promise<void> {
  (await cookies()).delete(VERIFY_COOKIE);
}

/**
 * The account `/verify-email` is for: this browser's pending cookie, else a signed-in session
 * (an account from before codes existed, whose address is still unverified).
 */
export async function verifyingUserId(): Promise<string | null> {
  return (await pendingVerificationUser()) ?? (await getSession())?.user.id ?? null;
}
