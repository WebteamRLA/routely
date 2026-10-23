import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The visual editor's session token — signing and verifying, as pure functions.
 *
 * Split from `server/editor-token.ts` for the same reason `lib/google-oauth-state.ts` is split from
 * its service: everything here takes its key and clock as arguments and reads no configuration, so
 * it is unit-testable without an environment.
 *
 * ## What it is for
 *
 * The editor opens the customer's real page with `#_rt_edit=<token>`. The installed SDK echoes the
 * token in its `routely:hello`, and the editor answers only a hello that carries the token it was
 * issued, from the page origin the token names, from the window it opened (see
 * `lib/editor-protocol.ts`). **The token grants no data access**: every change is saved through the
 * authenticated draft autosave, never through the page. What signing adds is that a token cannot be
 * made up or altered — its experiment, website, user, page origin and expiry are fixed when it is
 * issued — so any server-side use (`verifyEditorToken`) can trust what it reads.
 *
 * ## Format
 *
 * `rte1.<payload>.<signature>` — base64url JSON payload, base64url HMAC-SHA256 over
 * `rte1.<payload>`. Every character is in the SDK's accepted token alphabet (`[A-Za-z0-9._~-]`).
 *
 * Payload: `{ e: experimentId, w: websiteId, u: userId, o: page origin, x: expiry (epoch s),
 * n: nonce }`. The nonce makes every token unique, so two editor sessions on the same page never
 * share one.
 */

export const EDITOR_TOKEN_PREFIX = "rte1";

/** How long a token can start an editor session. The spec allows up to 30 minutes. */
export const EDITOR_TOKEN_TTL_SECONDS = 30 * 60;

/** Longest page origin a token carries. Anything longer is not a real customer origin. */
const MAX_ORIGIN = 255;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface EditorTokenClaims {
  experimentId: string;
  websiteId: string;
  userId: string;
  /** `https://shop.acme.com` — the only origin the editor accepts messages from. */
  origin: string;
  /** Epoch seconds. */
  expiresAt: number;
}

/** The origin of an http(s) URL, or null. Exported for the issuer and the tests. */
export function pageOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin.length <= MAX_ORIGIN ? parsed.origin : null;
  } catch {
    return null;
  }
}

function sign(secret: string | Buffer, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * Issues a token. Throws on claims no real session could have (an id of the wrong shape, an
 * origin that is not an http(s) origin) — those are programming errors, not user input.
 */
export function signEditorToken(input: {
  secret: string | Buffer;
  claims: EditorTokenClaims;
  /** Injectable for tests. */
  nonce?: string;
}): string {
  const { claims } = input;
  if (![claims.experimentId, claims.websiteId, claims.userId].every((id) => ID.test(id))) {
    throw new Error("Editor token ids must be id-shaped.");
  }
  if (pageOrigin(claims.origin) !== claims.origin) {
    throw new Error("Editor token origin must be an http(s) origin.");
  }
  if (!Number.isInteger(claims.expiresAt))
    throw new Error("Editor token expiry must be whole seconds.");

  const payload = Buffer.from(
    JSON.stringify({
      e: claims.experimentId,
      w: claims.websiteId,
      u: claims.userId,
      o: claims.origin,
      x: claims.expiresAt,
      n: input.nonce ?? randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  const body = `${EDITOR_TOKEN_PREFIX}.${payload}`;
  return `${body}.${sign(input.secret, body)}`;
}

/**
 * The claims of a valid, unexpired token, or null.
 *
 * Null for every failure rather than a reason — tampered, expired, malformed or signed with
 * another key all have the same remedy (open the editor again), and distinguishing them would
 * only help somebody probing. `expect` additionally pins claims the caller already knows, e.g.
 * the session user.
 */
export function verifyEditorToken(input: {
  secret: string | Buffer;
  token: string;
  nowMs: number;
  expect?: Partial<Pick<EditorTokenClaims, "experimentId" | "websiteId" | "userId" | "origin">>;
}): EditorTokenClaims | null {
  if (typeof input.token !== "string" || input.token.length > 2048) return null;
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== EDITOR_TOKEN_PREFIX) return null;

  const [prefix, payload, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(input.secret, `${prefix}.${payload}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  const { e, w, u, o, x } = raw;
  if (typeof e !== "string" || typeof w !== "string" || typeof u !== "string") return null;
  if (typeof o !== "string" || typeof x !== "number" || !Number.isInteger(x)) return null;

  const claims: EditorTokenClaims = {
    experimentId: e,
    websiteId: w,
    userId: u,
    origin: o,
    expiresAt: x,
  };
  if (claims.expiresAt * 1000 <= input.nowMs) return null;

  const expect = input.expect ?? {};
  for (const key of ["experimentId", "websiteId", "userId", "origin"] as const) {
    if (expect[key] !== undefined && expect[key] !== claims[key]) return null;
  }
  return claims;
}

/**
 * The signing key when no `EDITOR_TOKEN_SECRET` is configured: derived from `AUTH_SECRET` under a
 * fixed label, so the two keys are related only through a one-way function. A token signature can
 * then never double as anything `AUTH_SECRET` signs, and nothing signed with `AUTH_SECRET` can be
 * replayed as an editor token.
 */
export function deriveEditorKey(authSecret: string): Buffer {
  return createHmac("sha256", authSecret).update("routely/editor-token/v1").digest();
}
