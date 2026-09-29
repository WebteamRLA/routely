import "server-only";

import { env } from "@/env";
import { KEY_BYTES, decryptWithKey, encryptWithKey, type SecretPurpose } from "@/lib/secret-box";
import { AppError } from "@/server/errors";

/**
 * The configured-key half of secret storage.
 *
 * The cipher itself lives in `lib/secret-box.ts`, which takes an explicit key and reads no
 * configuration — that split is what makes the scheme unit-testable, since importing anything
 * that reaches `env.ts` under Vitest fails on the absence of a `DATABASE_URL` it does not need.
 * This module is the only thing that knows where the key comes from.
 */

export { SECRET_PURPOSES, type SecretPurpose } from "@/lib/secret-box";

/**
 * True when `TOKEN_ENCRYPTION_KEY` is configured.
 *
 * Mirrors `isAuthConfigured()` in `server/auth/session.ts`: a feature whose configuration is
 * missing reports itself unavailable in the UI, naming the variable, rather than throwing from
 * somewhere deep inside a request.
 *
 * Nothing here falls back to storing a token in the clear. A plaintext fallback would put a real
 * Google refresh token in a developer's Postgres unencrypted *and* make the development code path
 * differ from production — the combination that produces a surprise on deploy.
 */
export function isSecretStorageConfigured(): boolean {
  return Boolean(env.TOKEN_ENCRYPTION_KEY);
}

function encryptionKey(): Buffer {
  const configured = env.TOKEN_ENCRYPTION_KEY;

  if (!configured) {
    throw new AppError(
      "INTERNAL",
      "Secret storage is not configured. Set TOKEN_ENCRYPTION_KEY to enable integrations.",
    );
  }

  const key = Buffer.from(configured, "base64");

  // `env.ts` validates the shape with a regex because it is evaluated in the browser bundle too
  // and cannot touch `Buffer`. This is where the real length is asserted.
  if (key.length !== KEY_BYTES) {
    throw new AppError(
      "INTERNAL",
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }

  return key;
}

/** Encrypts using the configured key. Throws `AppError("INTERNAL")` when there is none. */
export function encryptSecret(plaintext: string, purpose: SecretPurpose): string {
  return encryptWithKey(encryptionKey(), plaintext, purpose);
}

/** Decrypts using the configured key. Throws `AppError("INTERNAL")` when there is none. */
export function decryptSecret(value: string, purpose: SecretPurpose): string {
  return decryptWithKey(encryptionKey(), value, purpose);
}
