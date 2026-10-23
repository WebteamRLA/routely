import "server-only";

import { randomBytes } from "node:crypto";

import { env } from "@/env";
import {
  EDITOR_TOKEN_TTL_SECONDS,
  type EditorTokenClaims,
  deriveEditorKey,
  signEditorToken,
  verifyEditorToken,
} from "@/lib/editor-token";
import { AppError } from "@/server/errors";

/**
 * The visual editor token with its configured key — the half of `lib/editor-token.ts` that reads
 * the environment.
 *
 * Key, in order of preference:
 *
 * 1. `EDITOR_TOKEN_SECRET`, when set.
 * 2. Derived from `AUTH_SECRET` (HMAC under a fixed label) — never `AUTH_SECRET` itself.
 * 3. Development only, with neither: a random key for the life of this process. Production always
 *    has `AUTH_SECRET` (`env.ts` refuses to start without it), so this branch cannot be reached
 *    there; refusing outright keeps it that way if that ever changes.
 */
let processKey: Buffer | null = null;

function editorTokenKey(): string | Buffer {
  if (env.EDITOR_TOKEN_SECRET) return env.EDITOR_TOKEN_SECRET;
  if (env.AUTH_SECRET) return deriveEditorKey(env.AUTH_SECRET);
  if (env.NODE_ENV === "production") {
    throw new AppError("INTERNAL", "EDITOR_TOKEN_SECRET or AUTH_SECRET is required.");
  }
  processKey ??= randomBytes(32);
  return processKey;
}

export function mintEditorToken(
  claims: Omit<EditorTokenClaims, "expiresAt">,
  nowMs: number = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(nowMs / 1000) + EDITOR_TOKEN_TTL_SECONDS;
  return {
    token: signEditorToken({ secret: editorTokenKey(), claims: { ...claims, expiresAt } }),
    expiresAt,
  };
}

/** For any server-side use of a token the editor handed back: its claims, or null. */
export function readEditorToken(
  token: string,
  expect?: Parameters<typeof verifyEditorToken>[0]["expect"],
  nowMs: number = Date.now(),
): EditorTokenClaims | null {
  return verifyEditorToken({ secret: editorTokenKey(), token, nowMs, expect });
}
