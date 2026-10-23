import "server-only";

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

import { env } from "@/env";
import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { RoutelyAdapter } from "@/server/auth/adapter";
import { SESSION_MAX_AGE_SECONDS, requestOrigin } from "@/server/auth/password-session";
import { db } from "@/server/db";

declare module "next-auth" {
  interface Session {
    /** The `sessions` row id. Read by the session seam; never trusted from a client. */
    sessionId?: string;
    /** `User.currentWorkspaceId` as loaded with the session. The seam re-checks membership. */
    currentWorkspaceId?: string | null;
  }
}

/** How stale `Session.lastSeenAt` may get before a request refreshes it. */
const SESSION_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Auth.js configuration.
 *
 * Kept separate from `index.ts` so the options can be read and reasoned about without
 * importing the initialised singleton, and so tests can assert on the config directly.
 */

/**
 * Sessions are stored in Postgres (the `sessions` table), not in a JWT.
 *
 * The trade-off is one database read per request, in exchange for sessions that can be
 * revoked server-side: signing out — or deleting a user — invalidates the session
 * immediately, whereas a signed JWT stays valid until it expires no matter what the server
 * does. For a dashboard that already queries the database on every page, that read is free.
 */
// `SESSION_MAX_AGE_SECONDS` (30 days) lives in `password-session.ts`, which mints the same rows
// for email + password sign-in and must expire them identically.

export const authConfig: NextAuthConfig = {
  // The stock Prisma adapter, plus a personal workspace on sign-up and session metadata — see
  // `adapter.ts`.
  adapter: RoutelyAdapter(),

  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Refresh the expiry at most once a day rather than on every request, so a browsing
    // session does not generate a write per page view.
    updateAge: 24 * 60 * 60,
  },

  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Deliberately left at its default (false): enabling it would link a Google account to
      // an existing user purely because the email matches, which lets anyone who can obtain
      // a Google account for that address take over the existing one.
      allowDangerousEmailAccountLinking: false,
    }),
  ],

  pages: {
    signIn: routes.login,
    // Auth.js renders its own error page by default. Routing errors back to the login screen
    // keeps the user in one place; the reason arrives as `?error=`.
    error: routes.login,
  },

  /**
   * Required behind the Nginx reverse proxy, where the request Host is set by
   * `X-Forwarded-Host`. On its own this would allow host-header injection into callback
   * URLs, so `src/env.ts` requires `AUTH_URL` in production: with an explicit canonical
   * origin configured, Auth.js builds callbacks from it rather than from the request.
   */
  trustHost: true,

  callbacks: {
    /**
     * Refuses a disabled account at the door (→ `?error=AccessDenied`, the design's "doesn't have
     * access" state). For an existing account `user` is the adapter's row; a first-time sign-in
     * has no row yet and so nothing to refuse.
     */
    signIn({ user }) {
      return !(user as { disabledAt?: Date | null }).disabledAt;
    },

    /**
     * The database strategy hands the adapter's user record to this callback. The default
     * session shape omits the id, and every service call needs it, so it is copied across
     * once here instead of being re-fetched by each caller.
     *
     * Under the database strategy `session` is the whole `sessions` row (Auth.js spreads it in),
     * so the result is built field by field rather than returned as received: that keeps the
     * session token itself out of the `/api/auth/session` response.
     *
     * Also refreshes `Session.lastSeenAt` for "Where you're signed in" — at most once per
     * `SESSION_SEEN_THROTTLE_MS`, decided from the row already loaded (so a fresh session costs
     * nothing) and written as a compare-and-set on the value read (so a burst writes once).
     */
    async session({ session, user }) {
      const row = session as unknown as { id?: string; lastSeenAt?: Date };
      const fullUser = user as typeof user & {
        currentWorkspaceId?: string | null;
        disabledAt?: Date | null;
      };

      // A disabled account keeps no session, even one minted before it was disabled.
      if (fullUser.disabledAt) {
        return { ...session, user: undefined } as unknown as typeof session;
      }

      if (row.id && row.lastSeenAt instanceof Date) {
        const now = Date.now();
        if (now - row.lastSeenAt.getTime() >= SESSION_SEEN_THROTTLE_MS) {
          await db.session
            .updateMany({
              where: { id: row.id, lastSeenAt: row.lastSeenAt },
              data: { lastSeenAt: new Date(now) },
            })
            .catch((error) => console.error("[routely] could not record session activity", error));
        }
      }

      return {
        expires: session.expires,
        sessionId: row.id,
        currentWorkspaceId: fullUser.currentWorkspaceId ?? null,
        user: {
          id: user.id,
          name: user.name ?? null,
          email: user.email,
          image: user.image ?? null,
        },
      };
    },

    /**
     * Open-redirect guard for `callbackUrl`. Auth.js already restricts redirects to the
     * configured origin; this narrows it further to same-origin absolute URLs and relative
     * paths, and refuses protocol-relative URLs like `//evil.example` that a naive
     * `startsWith("/")` check would let through.
     */
    redirect({ url, baseUrl }) {
      if (url.startsWith("/") && !url.startsWith("//")) {
        return `${baseUrl}${url}`;
      }

      try {
        if (new URL(url).origin === baseUrl) {
          return url;
        }
      } catch {
        // Fall through to the safe default.
      }

      return `${baseUrl}${AFTER_SIGN_IN}`;
    },
  },

  events: {
    /**
     * "New sign-in to Routely" for Google sign-ins from a (browser, OS, country) this account has
     * not used before — the password path does the same in its action. Loaded lazily: the account
     * service sits above this config in the import graph.
     */
    async signIn({ user }) {
      if (!user.id) return;
      const { noteSignIn } = await import("@/server/services/account.service");
      await noteSignIn(user.id, await requestOrigin());
    },

    /**
     * The adapter creates the `users` row on first sign-in; this records that it happened.
     * Useful when diagnosing "why do I have two accounts" reports, which are almost always a
     * second identity provider rather than a duplicate row.
     */
    createUser({ user }) {
      console.info("[routely] created user profile", { userId: user.id });
    },
  },

  debug: env.NODE_ENV === "development",
};
