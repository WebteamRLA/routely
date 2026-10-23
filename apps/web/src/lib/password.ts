import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing for email + password sign-in.
 *
 * scrypt from `node:crypto` rather than bcrypt/argon2 packages: it is memory-hard, built into Node,
 * and adds no dependency. The stored form carries its own parameters —
 * `scrypt$N$r$p$<salt>$<hash>` (salt and hash base64url) — so the cost can be raised later and
 * every existing hash still verifies; `needsRehash` says when one was made with older settings.
 *
 * No configuration and no database here, so it is unit-testable in isolation.
 */

/** 2^15 iterations, block size 8, no parallelism: ~32 MiB and ~50–100 ms per hash. */
const COST = { N: 32_768, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Upper bounds accepted when *verifying* a stored hash, so a corrupt row cannot make one request
 * allocate gigabytes. */
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** scrypt needs 128·N·r bytes; Node's default ceiling (32 MiB) is exactly too small for N=2^15. */
function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2;
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) {
  const options: ScryptOptions = { N, r, p, maxmem: maxmemFor(N, r) };
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Hashes a password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST.N, COST.r, COST.p, KEY_BYTES);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")]
    .map(String)
    .join("$");
}

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parse(encoded: string): Parsed | null {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map((x) => Number(x));
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // N must be a power of two above 1.
  if (N! < 2 || N! > MAX_N || (N! & (N! - 1)) !== 0) return null;
  if (r! < 1 || r! > MAX_R || p! < 1 || p! > MAX_P) return null;
  const salt = Buffer.from(parts[4]!, "base64url");
  const hash = Buffer.from(parts[5]!, "base64url");
  if (salt.length < 8 || hash.length < 16) return null;
  return { N: N!, r: r!, p: p!, salt, hash };
}

/**
 * True when `password` matches `encoded`. Never throws: a malformed stored value is simply "no
 * match". The comparison is constant-time.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parse(encoded);
  if (!parsed) return false;
  try {
    const key = await derive(
      password,
      parsed.salt,
      parsed.N,
      parsed.r,
      parsed.p,
      parsed.hash.length,
    );
    return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
  } catch {
    return false;
  }
}

/** A fixed hash of a random password, computed once, for equal-time rejection of unknown emails. */
let dummy: Promise<string> | null = null;

/**
 * Spends the same time a real verification would, then reports no match.
 *
 * Called when the email is unknown or the account has no password, so the response time does
 * not reveal which addresses have accounts.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummy);
  return false;
}

/** True when `encoded` was made with weaker parameters than the current ones. */
export function needsRehash(encoded: string): boolean {
  const parsed = parse(encoded);
  return !parsed || parsed.N < COST.N || parsed.r < COST.r || parsed.p < COST.p;
}

/**
 * The rule a new password must meet, in the design's words ("At least 8 characters.").
 *
 * Length only, deliberately: composition rules (a digit, a symbol…) push people towards
 * predictable substitutions without making passwords meaningfully stronger (NIST SP 800-63B).
 * The 128 cap bounds hashing work, and is generous for passphrases and password managers.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return "Use at least 8 characters.";
  if (password.length > PASSWORD_MAX) return "Use 128 characters or fewer.";
  return null;
}
