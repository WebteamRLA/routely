import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/env";
import { SECRET_PURPOSES, decryptSecret, encryptSecret } from "@/server/crypto";
import { AppError, validationFailed } from "@/server/errors";
import * as connectionRepo from "@/server/repositories/sheets-connection.repository";

import type { SheetsConnection } from "@/generated/prisma/client";

/**
 * The Google OAuth flow for the Sheets integration.
 *
 * ## Why this is not the Auth.js provider
 *
 * Sign-in already uses Google, so adding `spreadsheets` and Drive scopes to that provider looks
 * like the small change. It is the wrong one, twice over:
 *
 * 1. **Every customer would have to grant Drive access merely to log in.** The scopes on a
 *    provider apply to every authorization it performs, so a feature almost nobody uses would
 *    gate the front door for everybody, on a consent screen listing permissions the customer has
 *    no reason for.
 * 2. **The tokens would collide.** `Account` is keyed `@@unique([provider, providerAccountId])`,
 *    and the customer signing in is the same Google account they would connect Sheets with — so
 *    a second consent would write over the sign-in row. The adapter owns that table; sharing it
 *    means every Auth.js upgrade is a chance to lose a refresh token.
 *
 * So this is a separate, hand-rolled flow over its own routes, writing to its own table. It is
 * Google's standard authorization-code flow and nothing more; the four endpoints it touches are
 * spelled out at their call sites.
 *
 * ## Why hand-rolled rather than a library
 *
 * `googleapis` and `google-auth-library` are several megabytes of transitive dependency for four
 * HTTP requests against documented, stable endpoints. This app's only other outbound call is a
 * hand-written `fetch` in `pixel.service.ts`, so this stays consistent with it and adds nothing
 * to the install.
 */

/** Google's OAuth endpoints. Constants, which is why no SSRF guard is needed here. */
const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Scopes requested.
 *
 * **Every one of these is non-sensitive, and that is the whole point.** Google classifies scopes
 * as non-sensitive, sensitive or restricted; the latter two require an app-verification review
 * before *anyone outside the test-user list* can connect, and restricted scopes additionally
 * require a paid third-party security assessment, renewed annually. Staying entirely within
 * non-sensitive scopes means this integration can be used by real customers without waiting on
 * Google at all.
 *
 * - `openid` / `userinfo.email` — names the Google account that connected, so the customer can
 *   confirm they connected the one they meant to.
 * - `drive.file` — per-file access to spreadsheets **this app created, or the customer explicitly
 *   handed it via the Google Picker**. It grants nothing else in their Drive.
 *
 * Two earlier choices were replaced by this one, and both are worth knowing about because the
 * obvious instinct is to reach for them again:
 *
 * - **`spreadsheets` is not requested** even though this feature writes to spreadsheets. The
 *   Sheets API accepts Drive scopes, so `drive.file` authorises `values.append` and
 *   `spreadsheets.create` on a file the customer picked or we created. `spreadsheets` would grant
 *   access to *every* spreadsheet they own and is classified sensitive — strictly more power, for
 *   a verification review we do not otherwise need.
 * - **`drive.metadata.readonly` is not requested.** It was, briefly, to populate a dropdown of the
 *   customer's spreadsheets inside Routely. It is *restricted*, which is the most expensive tier
 *   Google has, and it bought only a list. The Google Picker shows the customer their whole Drive
 *   in Google's own window, using their own session, and hands back just the file they chose — the
 *   same outcome, with no verification and strictly less access.
 *
 * A consequence worth stating plainly: **Routely cannot enumerate a customer's spreadsheets.** A
 * Drive `files.list` under `drive.file` returns only files this app created, which would be a
 * misleading list rather than a useful one. Choosing an existing sheet goes through the Picker.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.file",
] as const;

/**
 * The scope the whole integration depends on.
 *
 * Covers creating a spreadsheet, reading the tab list of one the customer picked, and appending
 * rows to it — everything this feature does.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Name of the cookie holding the state nonce. Scoped to the integration's own routes. */
export const STATE_COOKIE = "routely.gsheets.state";

/** How long a consent flow may take before its state is refused. */
const STATE_TTL_SECONDS = 600;

/** Refresh this far before expiry, so a token cannot lapse mid-request. */
const REFRESH_SKEW_MS = 60_000;

/** True when both halves of the OAuth client are configured. */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError("INTERNAL", "Google OAuth is not configured.");
  }

  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

/**
 * The redirect URI, which must match what is registered in Google Cloud Console exactly.
 *
 * Built from `AUTH_URL` rather than from the incoming request's Host header. That is the whole
 * reason `AUTH_URL` is required in production (see `env.ts`): behind Nginx or Vercel the Host is
 * attacker-influenceable, and a redirect URI built from it is how an authorization code ends up
 * delivered somewhere else.
 */
export function redirectUri(): string {
  const origin = (env.AUTH_URL ?? env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, "");
  return `${origin}/api/integrations/google/callback`;
}

// ---------------------------------------------------------------------------
// State — CSRF protection for the callback
// ---------------------------------------------------------------------------

/**
 * A signed, expiring, user-bound state value.
 *
 * Three properties, each closing a different hole:
 *
 * - **Signed** with `AUTH_SECRET`, so state cannot be forged. `AUTH_SECRET` is the right key here
 *   rather than `TOKEN_ENCRYPTION_KEY`: this signs a ten-minute value, and the consequence of
 *   rotating it — in-flight consent flows fail and are retried — is harmless. Rotating the token
 *   key, by contrast, is an outage, which is why the two are separate.
 * - **Expiring**, so a state captured from a browser's history cannot be replayed later.
 * - **Bound to the user id**, so a state minted for one account cannot be completed by another.
 *   Without this, an attacker could start a flow, hand the URL to a victim, and have the victim's
 *   Google account connected to the attacker's Routely account.
 *
 * The nonce is *also* set as an httpOnly cookie and compared on return. The signature proves the
 * state came from us; the cookie proves it came back through the same browser that started it.
 */
export function mintState(userId: string): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;

  return { state: `${nonce}.${expiresAt}.${signState(nonce, expiresAt, userId)}`, nonce };
}

function signState(nonce: string, expiresAt: number, userId: string): string {
  if (!env.AUTH_SECRET) {
    throw new AppError("INTERNAL", "AUTH_SECRET is required to start an integration flow.");
  }

  return createHmac("sha256", env.AUTH_SECRET)
    .update(`${nonce}.${expiresAt}.${userId}`)
    .digest("base64url");
}

/**
 * Verifies a returned state against the signature, the clock, the session user and the cookie.
 *
 * Returns a plain boolean rather than throwing per-reason: distinguishing "bad signature" from
 * "expired" would only help somebody probing, and every failure has the same remedy — start again.
 */
export function verifyState(
  state: string,
  cookieNonce: string | undefined,
  userId: string,
): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;

  const [nonce, expiresAtRaw, signature] = parts as [string, string, string];
  const expiresAt = Number(expiresAtRaw);

  if (!Number.isInteger(expiresAt) || expiresAt * 1000 < Date.now()) return false;
  if (!cookieNonce || cookieNonce.length !== nonce.length) return false;

  const nonceMatches = timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(nonce));
  if (!nonceMatches) return false;

  const expected = Buffer.from(signState(nonce, expiresAt, userId));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The URL to send the customer to in order to grant access. */
export function authorizeUrl(state: string, loginHint?: string | null): string {
  const { clientId } = clientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // Without offline access Google issues no refresh token, and the sync would stop working an
    // hour after the customer closed the tab.
    access_type: "offline",
    // `consent` is what reliably re-issues a refresh token. A second authorization without it
    // commonly returns none at all, which looks like an intermittent bug and is not one.
    prompt: "consent",
    /*
     * `include_granted_scopes` is deliberately NOT set.
     *
     * It exists for incremental authorization: it asks Google to return every scope the customer
     * has previously granted alongside the new ones. That is the opposite of what is wanted here.
     * This app used to request the sensitive `spreadsheets` and restricted `drive.metadata.readonly`
     * scopes, and with that flag set, a customer who granted them once would keep getting them back
     * on every reconnect — so the narrowing to `drive.file` would never actually take effect for
     * the people who most need it. Omitting it means the grant is exactly what is asked for above.
     *
     * (A customer who granted the old scopes still holds them until they reconnect. Revoking
     * Routely at myaccount.google.com/permissions clears them outright.)
     */
    state,
  });

  // Pre-selects the account they signed into Routely with. A hint, not a restriction — they can
  // still choose another, which is why `googleEmail` is stored and displayed afterwards.
  if (loginHint) params.set("login_hint", loginHint);

  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postForm(url: string, body: URLSearchParams): Promise<TokenResponse> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Routely/1 (+https://routely.app)",
      },
      body,
      // A redirect from Google's token endpoint would be a bug, not a hop to follow.
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw validationFailed("Could not reach Google. Please try again.");
  }

  const text = await response.text();
  let parsed: TokenResponse;

  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    throw validationFailed("Google returned a response we could not read.");
  }

  if (!response.ok || parsed.error) {
    // `invalid_grant` is the one the caller must be able to recognise: it means the refresh token
    // is dead and the customer has to reconnect. Carried in the message rather than as a type,
    // because it is also the only one the caller branches on.
    throw new AppError("VALIDATION", googleErrorMessage(parsed.error, parsed.error_description), {
      cause: parsed.error,
    });
  }

  return parsed;
}

/** True when the failure means the customer must reconnect rather than retry. */
export function isInvalidGrant(error: unknown): boolean {
  return error instanceof AppError && error.cause === "invalid_grant";
}

function googleErrorMessage(error?: string, description?: string): string {
  if (error === "invalid_grant") {
    return "Google access was revoked or has expired. Reconnect to resume the daily sync.";
  }

  if (error === "invalid_client") {
    return "Routely's Google credentials were rejected. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.";
  }

  return description ? `Google refused the request: ${description}` : "Google refused the request.";
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  grantedScopes: string;
  email: string | null;
  subject: string | null;
}

/** Exchanges the authorization code for tokens. */
export async function exchangeCode(code: string): Promise<ExchangedTokens> {
  const { clientId, clientSecret } = clientCredentials();

  const payload = await postForm(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  );

  if (!payload.access_token) {
    throw validationFailed("Google did not return an access token. Please try connecting again.");
  }

  /*
   * No refresh token means the sync cannot run tomorrow, so this fails now rather than producing
   * a connection that works for an hour. It happens when the customer has already granted these
   * scopes and Google decides a fresh refresh token is unnecessary — `prompt=consent` is meant to
   * prevent it, and the remedy when it happens anyway is to remove Routely at
   * myaccount.google.com/permissions and start again.
   */
  if (!payload.refresh_token) {
    throw validationFailed(
      "Google did not grant long-lived access. Remove Routely at myaccount.google.com/permissions, then connect again.",
    );
  }

  const identity = readIdToken(payload.id_token);

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: expiryFrom(payload.expires_in),
    // What Google actually granted, which is not necessarily what was asked for — the consent
    // screen lets a customer untick individual scopes.
    grantedScopes: payload.scope ?? "",
    email: identity.email,
    subject: identity.subject,
  };
}

/**
 * Reads the display fields out of an ID token.
 *
 * The signature is deliberately **not** verified. This token arrived over TLS directly from
 * Google's token endpoint in response to our own authenticated request — it was not relayed
 * through the browser — so there is no untrusted party in the path. The values are used only to
 * show the customer which account they connected; nothing is authorized on the basis of them.
 * (An ID token received any other way would have to be verified.)
 */
function readIdToken(idToken?: string): { email: string | null; subject: string | null } {
  if (!idToken) return { email: null, subject: null };

  try {
    const payload = idToken.split(".")[1];
    if (!payload) return { email: null, subject: null };

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
      sub?: unknown;
    };

    return {
      email: typeof claims.email === "string" ? claims.email : null,
      subject: typeof claims.sub === "string" ? claims.sub : null,
    };
  } catch {
    // A display string is not worth failing a connection over.
    return { email: null, subject: null };
  }
}

function expiryFrom(expiresInSeconds?: number): Date {
  // Google sends 3599; the fallback is only for a malformed response.
  const seconds =
    typeof expiresInSeconds === "number" && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  return new Date(Date.now() + seconds * 1000);
}

/** Revokes a token at Google. Used on disconnect. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    // Deliberately swallowed. A revoke that fails must not block the disconnect: leaving a row we
    // can no longer use would show the customer a connection that does nothing, which is worse
    // than a grant lingering at Google that they can remove themselves.
  }
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

/**
 * In-flight refreshes, keyed by connection.
 *
 * Coalesces concurrent refreshes within one process — the same pattern as the cached dev-user
 * promise in `session.ts`, including deleting the entry on failure so a transient error is not
 * cached and retried forever.
 *
 * **There is deliberately no cross-process lock.** Google does not rotate refresh tokens by
 * default and does not invalidate an existing access token when it issues another, so two
 * instances refreshing at once both end up with working tokens and the only cost is a duplicate
 * request plus last-writer-wins on a cache column. A distributed lock would add a failure mode in
 * order to prevent a non-problem.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * A usable access token for a connection, refreshing if necessary.
 *
 * The only place a token is obtained, so the refresh, the re-encryption and the
 * needs-reconnect transition all happen in one place.
 */
export async function getAccessToken(connection: SheetsConnection): Promise<string> {
  const cached = cachedAccessToken(connection);
  if (cached) return cached;

  const pending = inFlight.get(connection.id);
  if (pending) return pending;

  const refresh = refreshAccessToken(connection).finally(() => {
    inFlight.delete(connection.id);
  });

  inFlight.set(connection.id, refresh);
  return refresh;
}

function cachedAccessToken(connection: SheetsConnection): string | null {
  if (!connection.accessTokenCipher || !connection.accessTokenExpiresAt) return null;
  if (connection.accessTokenExpiresAt.getTime() - Date.now() <= REFRESH_SKEW_MS) return null;

  try {
    return decryptSecret(connection.accessTokenCipher, SECRET_PURPOSES.googleAccessToken);
  } catch {
    // A cached token that will not decrypt — a rotated key, or a corrupted row. Refreshing is the
    // correct recovery, and it is cheap.
    return null;
  }
}

async function refreshAccessToken(connection: SheetsConnection): Promise<string> {
  const { clientId, clientSecret } = clientCredentials();
  const refreshToken = decryptSecret(
    connection.refreshTokenCipher,
    SECRET_PURPOSES.googleRefreshToken,
  );

  let payload: TokenResponse;

  try {
    payload = await postForm(
      TOKEN_ENDPOINT,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    );
  } catch (error) {
    if (isInvalidGrant(error)) {
      await connectionRepo.markNeedsReconnect(
        connection.id,
        "Google access was revoked or has expired. Reconnect to resume the daily sync.",
      );
    }

    throw error;
  }

  if (!payload.access_token) {
    throw validationFailed("Google did not return an access token.");
  }

  const expiresAt = expiryFrom(payload.expires_in);

  await connectionRepo.storeAccessToken(
    connection.id,
    encryptSecret(payload.access_token, SECRET_PURPOSES.googleAccessToken),
    expiresAt,
  );

  // Google normally omits this on a refresh. Persisted when present, as cheap insurance against
  // a future in which it does rotate them.
  if (payload.refresh_token) {
    await connectionRepo.storeRefreshToken(
      connection.id,
      encryptSecret(payload.refresh_token, SECRET_PURPOSES.googleRefreshToken),
    );
  }

  return payload.access_token;
}

/**
 * True when the connection can create spreadsheets and write to ones the customer picked.
 *
 * Granular consent lets a customer untick individual scopes on Google's screen, and the token
 * response's `scope` field is the only truthful record of what was actually granted — so this
 * reads what Google returned rather than assuming we got what we asked for.
 */
export function canUseSheets(grantedScopes: string): boolean {
  return grantedScopes.split(/\s+/).includes(DRIVE_FILE_SCOPE);
}
