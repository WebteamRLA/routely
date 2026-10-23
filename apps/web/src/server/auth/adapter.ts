import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies, headers } from "next/headers";

import { db } from "@/server/db";
import { INVITE_COOKIE } from "@/server/auth/invite-cookie";
import { isAppError } from "@/server/errors";
import { createPersonalWorkspace } from "@/server/auth/workspace";
import { acceptInvite, findPendingInvite } from "@/server/services/team.service";

/**
 * The Auth.js Prisma adapter, with two additions.
 *
 * 1. **`createUser` also gives the user a workspace**, in the same transaction, so an account can
 *    never exist without one. Normally that is their own — "{First}’s workspace" with them as
 *    OWNER, set as current. When they are signing up *through an invite* (the invite page set the
 *    `routely-invite` cookie before sending them to Google) and the invite is valid and addressed to
 *    this Google email, they join only the inviting workspace instead, which avoids an orphan
 *    personal workspace. Google sign-ups are recorded as email-verified: Google has proven the
 *    address, and notifications and invites are only sent from/to verified addresses.
 * 2. **`createSession` records where the session came from** — the User-Agent, and the city and
 *    country when the platform supplies them — for Settings → "Where you're signed in". The
 *    adapter's own reads ignore these extra columns.
 *
 * Everything else is the stock adapter, untouched.
 */

type BaseAdapter = ReturnType<typeof PrismaAdapter>;
type CreateUser = NonNullable<BaseAdapter["createUser"]>;
type CreateSession = NonNullable<BaseAdapter["createSession"]>;

/** Longest User-Agent stored. Real ones are ~150 characters; anything far longer is junk. */
const USER_AGENT_MAX = 512;

export function RoutelyAdapter(): BaseAdapter {
  // The adapter's types are written against the `@prisma/client` package, while this project
  // generates its client into src/generated/prisma. The runtime shape is identical — the adapter
  // only calls model methods — so the structural mismatch is narrowed here.
  const base = PrismaAdapter(db as never);

  const createUser: CreateUser = async ({ id: _ignored, ...data }) => {
    // Auth.js passes `undefined` for absent profile fields; Prisma would reject some of them.
    const clean = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as typeof data;

    const inviteToken = await readInviteCookie();
    const invite = inviteToken ? await findPendingInvite(inviteToken) : null;
    const viaInvite =
      invite && typeof clean.email === "string" && clean.email.toLowerCase() === invite.email;

    return db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { ...clean, emailVerified: clean.emailVerified ?? new Date() },
      });
      if (viaInvite && inviteToken) {
        // The invite can lose a race (revoked or accepted a moment ago). Its refusals are raised
        // before any write, so the transaction is still usable and sign-up falls back to a
        // personal workspace rather than failing.
        const joined = await acceptInvite(user.id, inviteToken, tx).catch((error: unknown) => {
          if (isAppError(error)) return null;
          throw error;
        });
        if (joined) return { ...user, currentWorkspaceId: joined.workspaceId };
      }
      const membership = await createPersonalWorkspace(tx, user);
      return { ...user, currentWorkspaceId: membership.workspaceId };
    });
  };

  const createSession: CreateSession = async (session) => {
    const origin = await requestOrigin();
    return db.session.create({ data: { ...session, ...origin } });
  };

  return { ...base, createUser, createSession };
}

/** The invite token remembered by the invite page, consumed on read. Null outside a request. */
async function readInviteCookie(): Promise<string | null> {
  try {
    const jar = await cookies();
    const value = jar.get(INVITE_COOKIE)?.value ?? null;
    if (value) jar.delete(INVITE_COOKIE);
    return value;
  } catch {
    return null;
  }
}

/**
 * Where the sign-in request came from. Best effort: outside a request scope, or behind a proxy that
 * strips these headers, every field is simply null.
 *
 * `x-vercel-ip-*` are set by Vercel's edge and cannot be supplied by the client there. Behind any
 * other proxy they would be client-controlled, which is acceptable for a display-only "signed in
 * from" hint and must never be used for an access decision.
 */
async function requestOrigin(): Promise<{
  userAgent: string | null;
  city: string | null;
  country: string | null;
}> {
  try {
    const list = await headers();
    const city = list.get("x-vercel-ip-city");
    const country = list.get("x-vercel-ip-country");

    return {
      userAgent: list.get("user-agent")?.slice(0, USER_AGENT_MAX) ?? null,
      city: city ? decodeURIComponent(city).slice(0, 100) : null,
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    };
  } catch {
    return { userAgent: null, city: null, country: null };
  }
}
