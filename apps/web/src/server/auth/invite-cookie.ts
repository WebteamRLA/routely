import "server-only";

/**
 * The cookie that carries an invite through Google sign-in.
 *
 * Set by `continueInviteWithGoogle` on the invite page, read once by the adapter's `createUser`
 * when Google sign-in creates a new account. Short-lived: it only has to survive one round trip to
 * Google's consent screen. It holds the raw invite token (already a bearer secret delivered by
 * email) and grants nothing on its own — the adapter re-validates the invite and requires the
 * Google address to be the invited one.
 */
export const INVITE_COOKIE = "routely-invite";
export const INVITE_COOKIE_MAX_AGE_S = 15 * 60;
