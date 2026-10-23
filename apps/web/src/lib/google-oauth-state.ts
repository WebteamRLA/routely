import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The pure half of the Google Sheets consent flow's state handling: signing, verifying, the
 * `returnTo` allow-list and reading the display claims out of an ID token.
 *
 * Split from `server/services/google-oauth.service.ts` for the same reason `lib/secret-box.ts` is
 * split from `server/crypto.ts`: everything here takes its key as an argument and reads no
 * configuration, so it can be unit-tested without an environment. The service supplies
 * `AUTH_SECRET` and the clock.
 *
 * ## What the state carries
 *
 * `nonce.expiresAt.payload.signature`, where `payload` is base64url JSON `{ w, r }`:
 *
 * - `w` — the **workspace** the grant will be stored on. Decided when the flow starts (from the
 *   project the button sits on, or the active workspace on the Integrations page), so a callback
 *   cannot be steered at a different workspace.
 * - `r` — where to send the customer afterwards: the Integrations page or a project dashboard.
 *
 * The HMAC covers the nonce, the expiry, the **session user id** (which is deliberately *not* in
 * the payload — it comes from the session on both ends) and the payload. Changing any of them
 * breaks the signature.
 */

/** The places a finished consent flow may land. Everything else falls back to Integrations. */
export const DEFAULT_RETURN_TO = "/integrations";

/** `/projects/<id>` with an id-shaped segment, or `/integrations`. Nothing else, ever. */
const RETURN_TO_PATTERN = /^\/(?:integrations|projects\/[A-Za-z0-9_-]{1,64})$/;

/**
 * Narrows a candidate path to the allow-list.
 *
 * An allow-list rather than "any relative path": a callback that redirects to wherever the state
 * says is an open redirect the moment anything upstream is wrong. Two exact shapes cannot be bent
 * into `//evil.test`, `/\evil.test`, `/integrations/../..` or a URL with a scheme.
 */
export function sanitizeReturnTo(value: unknown): string {
  return typeof value === "string" && RETURN_TO_PATTERN.test(value) ? value : DEFAULT_RETURN_TO;
}

export interface StatePayload {
  /** The workspace the grant is stored on. */
  workspaceId: string;
  /** Allow-listed path to return to. */
  returnTo: string;
}

function sign(
  secret: string,
  nonce: string,
  expiresAt: number,
  userId: string,
  payload: string,
): string {
  return createHmac("sha256", secret)
    .update(`${nonce}.${expiresAt}.${userId}.${payload}`)
    .digest("base64url");
}

function encodePayload(payload: StatePayload): string {
  return Buffer.from(
    JSON.stringify({ w: payload.workspaceId, r: sanitizeReturnTo(payload.returnTo) }),
  ).toString("base64url");
}

function decodePayload(encoded: string): StatePayload | null {
  try {
    const raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      w?: unknown;
      r?: unknown;
    };
    if (typeof raw.w !== "string" || raw.w.length === 0) return null;
    return { workspaceId: raw.w, returnTo: sanitizeReturnTo(raw.r) };
  } catch {
    return null;
  }
}

/** Builds a signed state value. The nonce is minted by the caller and also set as a cookie. */
export function signState(input: {
  secret: string;
  nonce: string;
  expiresAt: number;
  userId: string;
  payload: StatePayload;
}): string {
  const encoded = encodePayload(input.payload);
  const signature = sign(input.secret, input.nonce, input.expiresAt, input.userId, encoded);
  return `${input.nonce}.${input.expiresAt}.${encoded}.${signature}`;
}

/**
 * Verifies a returned state against the signature, the clock, the session user and the cookie,
 * and returns what it carries.
 *
 * Null for every failure rather than a reason: distinguishing "bad signature" from "expired" would
 * only help somebody probing, and every failure has the same remedy — start again.
 */
export function verifyState(input: {
  secret: string;
  state: string;
  cookieNonce: string | undefined;
  userId: string;
  nowMs: number;
}): StatePayload | null {
  const parts = input.state.split(".");
  if (parts.length !== 4) return null;

  const [nonce, expiresAtRaw, encoded, signature] = parts as [string, string, string, string];
  const expiresAt = Number(expiresAtRaw);

  if (!Number.isInteger(expiresAt) || expiresAt * 1000 < input.nowMs) return null;
  if (!input.cookieNonce || input.cookieNonce.length !== nonce.length) return null;
  if (!timingSafeEqual(Buffer.from(input.cookieNonce), Buffer.from(nonce))) return null;

  const expected = Buffer.from(sign(input.secret, nonce, expiresAt, input.userId, encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return decodePayload(encoded);
}

/**
 * Where a callback should land when the state could *not* be verified.
 *
 * Reads `r` from the unverified payload, which is safe only because it goes through the same
 * allow-list: the worst a forged value can do is pick between two of our own pages.
 */
export function unverifiedReturnTo(state: string | null): string {
  const encoded = state?.split(".")[2];
  return encoded ? (decodePayload(encoded)?.returnTo ?? DEFAULT_RETURN_TO) : DEFAULT_RETURN_TO;
}

export interface IdTokenClaims {
  email: string | null;
  subject: string | null;
  name: string | null;
  picture: string | null;
}

const NO_CLAIMS: IdTokenClaims = { email: null, subject: null, name: null, picture: null };

/**
 * Reads the display fields out of an ID token.
 *
 * The signature is deliberately **not** verified: the token arrived over TLS directly from
 * Google's token endpoint in response to our own authenticated request, never through the
 * browser. The values only label the connection; nothing is authorized on the basis of them.
 *
 * `name` and `picture` are present only when the grant includes the `profile` scope, which this
 * integration does not request (see `GOOGLE_SCOPES`); they are read when Google sends them and
 * are otherwise null, and the UI falls back to initials from the email. A picture is kept only
 * when it is an https URL on a Google host, because it ends up in an `<img src>`.
 */
export function readIdTokenClaims(idToken?: string): IdTokenClaims {
  if (!idToken) return NO_CLAIMS;

  try {
    const payload = idToken.split(".")[1];
    if (!payload) return NO_CLAIMS;

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const text = (value: unknown, max: number): string | null =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

    return {
      email: text(claims.email, 320),
      subject: text(claims.sub, 255),
      name: text(claims.name, 200),
      picture: safePicture(claims.picture),
    };
  } catch {
    // A display string is not worth failing a connection over.
    return NO_CLAIMS;
  }
}

function safePicture(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const googleHost =
      url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com");
    return url.protocol === "https:" && googleHost ? url.toString() : null;
  } catch {
    return null;
  }
}
