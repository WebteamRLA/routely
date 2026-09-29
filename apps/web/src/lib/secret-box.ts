import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated encryption for the few values that must be stored but must not be readable from
 * a database dump.
 *
 * Today that is exactly one thing: a Google OAuth refresh token. It is the only value Routely
 * stores that grants ongoing access to something *outside* Routely — somebody else's Google
 * Drive — so a leaked backup of this database would otherwise be a leak of customers' Drive
 * access, which is a materially worse outcome than a leak of Routely's own data.
 *
 * ## Why AES-256-GCM
 *
 * GCM authenticates as well as encrypts, so a modified ciphertext fails to decrypt rather than
 * decrypting to something else. That matters because the plaintext here is fed straight to
 * Google: without authentication, an attacker with write access to the database could swap in a
 * refresh token of their own and have the daily sync write one customer's data into another
 * customer's spreadsheet. CBC or CTR would encrypt and not notice.
 *
 * ## The format
 *
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 *
 * - **`v1`** is a scheme version, not decoration. Changing IV length, cipher or KDF later needs a
 *   way to read what is already stored; a bare blob offers none, and guessing from length is how
 *   that goes wrong.
 * - **The IV is 12 bytes and random per value.** 96 bits is GCM's standard nonce length and the
 *   one for which its security proof holds. Reusing an IV under one key is the single
 *   catastrophic misuse of GCM — it leaks the XOR of two plaintexts *and* the authentication
 *   subkey — so it is generated fresh on every call and never derived from anything.
 * - **The tag is 16 bytes**, GCM's full tag. Truncating it weakens forgery resistance for four
 *   bytes of storage.
 *
 * ## Additional authenticated data
 *
 * Every value is bound to a `purpose` string, which is authenticated but not encrypted. A
 * ciphertext therefore cannot be lifted out of one column and pasted into another — moving a
 * refresh token into the access-token column produces a decryption failure, not a working token
 * with the wrong lifetime. It costs nothing and removes a whole class of confused-deputy bug.
 *
 * ## What this is not
 *
 * Not a key-management system. The key lives in an environment variable, so anyone who can read
 * the environment can decrypt. That is the intended threat model: this protects against a
 * database leak, a stolen backup, or a `pg_dump` in the wrong hands — not against a compromised
 * application server, which by definition holds the key it needs to do its job.
 */

/** Scheme version. Read on decrypt so a future v2 can still read v1 rows. */
const VERSION = "v1";

/** GCM's standard nonce length. See the note above on why this is not negotiable. */
const IV_BYTES = 12;

/** GCM's full authentication tag. */
const TAG_BYTES = 16;

/** AES-256. */
export const KEY_BYTES = 32;

/**
 * Purposes a secret can be stored for. Authenticated as AAD, so a ciphertext is usable only in
 * the role it was created for.
 */
export const SECRET_PURPOSES = {
  googleRefreshToken: "routely:v1:google-refresh-token",
  googleAccessToken: "routely:v1:google-access-token",
} as const;

export type SecretPurpose = (typeof SECRET_PURPOSES)[keyof typeof SECRET_PURPOSES];

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

/**
 * Encrypts with an explicit key.
 *
 * The key-taking form is what the tests exercise: it is a pure function of its arguments, so
 * round-tripping, tampering and purpose-binding can all be asserted without an environment.
 */
export function encryptWithKey(key: Buffer, plaintext: string, purpose: SecretPurpose): string {
  assertKey(key);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, base64url(iv), base64url(tag), base64url(ciphertext)].join(".");
}

/**
 * Decrypts a value produced by `encryptWithKey`.
 *
 * Throws on anything that is not exactly what it wrote: wrong version, wrong shape, wrong
 * purpose, wrong key, or a single flipped bit anywhere. Every one of those is a programming
 * error or an attack, and neither should be recoverable into a partial result.
 */
export function decryptWithKey(key: Buffer, value: string, purpose: SecretPurpose): string {
  assertKey(key);

  const parts = value.split(".");

  if (parts.length !== 4) {
    throw new Error("Malformed encrypted value: expected four dot-separated parts");
  }

  const [version, ivPart, tagPart, ciphertextPart] = parts as [string, string, string, string];

  if (version !== VERSION) {
    throw new Error(`Unsupported encryption scheme: ${JSON.stringify(version)}`);
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  // Checked before reaching the cipher: `createDecipheriv` accepts several IV lengths for GCM,
  // and silently accepting a non-standard one would mean reading back a value written by a
  // scheme this code does not implement.
  if (iv.length !== IV_BYTES) {
    throw new Error(`Malformed encrypted value: IV must be ${IV_BYTES} bytes`);
  }

  if (tag.length !== TAG_BYTES) {
    throw new Error(`Malformed encrypted value: auth tag must be ${TAG_BYTES} bytes`);
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(purpose, "utf8"));
  decipher.setAuthTag(tag);

  // `final()` is where GCM verifies the tag, so this throws for a tampered ciphertext, the wrong
  // key and the wrong purpose alike — deliberately indistinguishable, since telling them apart
  // would only help someone probing.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

/**
 * Constant-time comparison of two short secrets supplied as strings.
 *
 * Lives here because the cron endpoint needs it and it is the same concern. Both sides are hashed
 * to a fixed width first: `timingSafeEqual` throws on a length mismatch, so comparing raw values
 * would leak the expected length through an exception, and returning early on length would leak
 * it through timing.
 */
export function secretsMatch(a: string, b: string): boolean {
  const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

  return timingSafeEqual(digest(a), digest(b));
}
