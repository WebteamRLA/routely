import "server-only";

import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { type IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

import { isPrivateAddress } from "@/lib/private-address";

/**
 * An SSRF-guarded GET for URLs a customer supplies (install checks, tracking checks).
 *
 * Fetching a customer-supplied URL is a server-side request forgery vector by construction:
 * without limits it is a "make the Routely server request this for me" endpoint. The guards, each
 * covering something the others do not:
 *
 *  1. **http(s) only.** No `file:`, `data:`, `gopher:` or anything else a URL can name.
 *  2. **No private address space** — loopback, link-local (incl. the `169.254.169.254` metadata
 *     endpoint), RFC 1918, CGNAT, multicast, IPv4-mapped IPv6 forms of all of them. Checked on the
 *     **address actually connected to**: the check runs inside the socket's own DNS lookup, so a
 *     name that resolves to a public address for a pre-check and a private one a moment later
 *     (DNS rebinding) cannot slip through between check and connect.
 *  3. **Redirects followed by hand**, every hop re-validated (scheme, `allowUrl`, address),
 *     at most `maxRedirects`.
 *  4. **Bounded** — one overall deadline across every hop, and the body is cut off at `maxBytes`
 *     (after decompression).
 *
 * Built on `node:http(s)` rather than `fetch` because only the former exposes the connect-time
 * `lookup` hook that guard 2 needs, and the locked stack rules out adding an HTTP client.
 *
 * Never throws: every failure is a value, so callers decide what each outcome means.
 */

export interface SafeFetchOptions {
  /** Default 5 s, across all hops. */
  timeoutMs?: number;
  /** Default 2 MB. The body is truncated (not rejected) beyond it. */
  maxBytes?: number;
  /** Default 3. */
  maxRedirects?: number;
  /**
   * Per-hop policy beyond the built-in guards, e.g. "must stay on the website's domain". Return a
   * message to refuse the URL, or null to allow it. Applied to the first URL and every redirect.
   */
  allowUrl?: (url: URL) => string | null;
  /**
   * Skip the private-address guard. **Development only** — a local site at `mysite.local` resolves
   * to loopback by design. Callers pass `env.NODE_ENV !== "production"`, never a request value.
   */
  allowPrivate?: boolean;
  /** Sent as `User-Agent`. */
  userAgent?: string;
  /** Sent as `Accept`. Default: HTML. */
  accept?: string;
}

export type SafeFetchFailure =
  | "invalid_url"
  | "blocked_url"
  | "blocked_address"
  | "unresolvable"
  | "too_many_redirects"
  | "timeout"
  | "network";

export type SafeFetchResult =
  | {
      ok: true;
      /** The final (non-redirect) response's status — may be ≥ 400; the caller decides. */
      status: number;
      finalUrl: string;
      contentType: string | null;
      body: string;
      /** The same body undecoded, for binary responses (an image). */
      bytes: Buffer;
      /** True when the body was cut off at `maxBytes`. */
      truncated: boolean;
      redirects: number;
      /**
       * The final response's cache headers (`CACHE_HEADERS`, lower-cased names) — which cache, if
       * any, answered. Only these: nothing else from the response is kept.
       */
      cacheHeaders: Record<string, string>;
    }
  | {
      ok: false;
      reason: SafeFetchFailure;
      /** Human-readable, safe to show the customer. */
      message: string;
      /** The URL being fetched when it failed. */
      url: string;
    };

/** Headers that say whether a cache answered: host caches (Nginx, Varnish), LiteSpeed, CDNs. */
const CACHE_HEADERS = [
  "x-cache",
  "x-cache-status",
  "x-proxy-cache",
  "x-fastcgi-cache",
  "x-litespeed-cache",
  "x-qc-cache",
  "x-sucuri-cache",
  "x-kinsta-cache",
  "cf-cache-status",
  "age",
] as const;

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT = "RoutelyInstallCheck/1 (+https://routely.app)";
const DEFAULT_ACCEPT = "text/html,application/xhtml+xml";

/** Thrown inside the lookup hook so the request fails with a recognisable cause. */
class BlockedAddressError extends Error {
  constructor(readonly hostname: string) {
    super(`${hostname} resolves to a private address`);
  }
}

class UnresolvableError extends Error {
  constructor(readonly hostname: string) {
    super(`${hostname} could not be resolved`);
  }
}

/**
 * A `lookup` for the socket that refuses private addresses. Handles both callback shapes Node
 * uses (`all: true` → an array, otherwise one address), refusing if **any** returned address is
 * private, so happy-eyeballs cannot pick the private one.
 */
function guardedLookup(): LookupFunction {
  return ((hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error || addresses.length === 0) {
        callback(new UnresolvableError(hostname));
        return;
      }
      if (addresses.some((entry) => isPrivateAddress(entry.address))) {
        callback(new BlockedAddressError(hostname));
        return;
      }
      if (options.all) {
        callback(null, addresses);
      } else {
        const first = addresses[0]!;
        callback(null, first.address, first.family);
      }
    });
  }) as LookupFunction;
}

function fail(reason: SafeFetchFailure, message: string, url: string): SafeFetchResult {
  return { ok: false, reason, message, url };
}

interface Hop {
  status: number;
  location: string | null;
  contentType: string | null;
  bytes: Buffer;
  truncated: boolean;
  cacheHeaders: Record<string, string>;
}

function pickCacheHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of CACHE_HEADERS) {
    const value = headers[name];
    if (value !== undefined) picked[name] = String(value).slice(0, 100);
  }
  return picked;
}

/** One request, no redirect following. Rejects with the socket/lookup error. */
function requestOnce(
  url: URL,
  options: {
    allowPrivate: boolean;
    userAgent: string;
    accept: string;
    maxBytes: number;
    signal: AbortSignal;
  },
): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;

    const req = send(
      url,
      {
        method: "GET",
        signal: options.signal,
        headers: {
          // Some hosts serve a different document, or none at all, without these.
          "User-Agent": options.userAgent,
          Accept: options.accept,
          "Accept-Encoding": "gzip, deflate, br",
        },
        ...(options.allowPrivate ? {} : { lookup: guardedLookup() }),
      },
      (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location ?? null;
        const contentType = response.headers["content-type"] ?? null;
        const cacheHeaders = pickCacheHeaders(response.headers);

        if (status >= 300 && status < 400) {
          response.resume();
          resolve({
            status,
            location,
            contentType,
            bytes: Buffer.alloc(0),
            truncated: false,
            cacheHeaders,
          });
          return;
        }

        let stream: Readable = response;
        const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
        if (encoding === "gzip" || encoding === "x-gzip") stream = response.pipe(createGunzip());
        else if (encoding === "deflate") stream = response.pipe(createInflate());
        else if (encoding === "br") stream = response.pipe(createBrotliDecompress());

        const chunks: Buffer[] = [];
        let total = 0;
        let done = false;

        const finish = (truncated: boolean) => {
          if (done) return;
          done = true;
          resolve({
            status,
            location,
            contentType,
            bytes: Buffer.concat(chunks),
            truncated,
            cacheHeaders,
          });
        };

        stream.on("data", (chunk: Buffer) => {
          if (done) return;
          const room = options.maxBytes - total;
          if (chunk.byteLength >= room) {
            chunks.push(chunk.subarray(0, room));
            total += room;
            finish(true);
            response.destroy();
            return;
          }
          chunks.push(chunk);
          total += chunk.byteLength;
        });
        stream.on("end", () => finish(false));
        stream.on("error", (error) => {
          // A broken compressed stream after some bytes still yields what was read.
          if (total > 0) finish(true);
          else if (!done) {
            done = true;
            reject(error);
          }
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

/** Refusals that do not depend on DNS: scheme, literal private IPs, and the caller's policy. */
function preflight(
  url: URL,
  options: Required<Pick<SafeFetchOptions, "allowPrivate">> & SafeFetchOptions,
): SafeFetchResult | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("blocked_url", "Only http and https addresses can be checked.", url.href);
  }
  if (url.username || url.password) {
    return fail("blocked_url", "Addresses with a username or password can't be checked.", url.href);
  }

  // `new URL` keeps IPv6 literals bracketed.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!options.allowPrivate && isIP(host) !== 0 && isPrivateAddress(host)) {
    return fail(
      "blocked_address",
      `${url.hostname} is a private address, so we can't reach it from here.`,
      url.href,
    );
  }
  if (!options.allowPrivate && (host === "localhost" || host.endsWith(".localhost"))) {
    return fail(
      "blocked_address",
      `${url.hostname} is a private address, so we can't reach it from here.`,
      url.href,
    );
  }

  const refusal = options.allowUrl?.(url) ?? null;
  if (refusal) return fail("blocked_url", refusal, url.href);

  return null;
}

export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowPrivate = options.allowPrivate ?? false;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const accept = options.accept ?? DEFAULT_ACCEPT;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return fail("invalid_url", "Enter a full URL, including https://", input);
  }

  // One deadline for the whole chain, so three slow redirects cannot add up to 4× the limit.
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const refused = preflight(url, { ...options, allowPrivate });
    if (refused) return refused;

    let response: Hop;
    try {
      response = await requestOnce(url, { allowPrivate, userAgent, accept, maxBytes, signal });
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      if (cause instanceof BlockedAddressError || error instanceof BlockedAddressError) {
        return fail(
          "blocked_address",
          `${url.hostname} resolves to a private address, so we can't reach it from here.`,
          url.href,
        );
      }
      if (cause instanceof UnresolvableError || error instanceof UnresolvableError) {
        return fail(
          "unresolvable",
          `We couldn't resolve ${url.hostname}. Check the address and try again.`,
          url.href,
        );
      }
      if (signal.aborted) {
        return fail("timeout", `${url.href} took too long to respond.`, url.href);
      }
      return fail(
        "network",
        `We couldn't load ${url.href}. Check the site is running and reachable.`,
        url.href,
      );
    }

    if (response.status >= 300 && response.status < 400 && response.location) {
      if (hop === maxRedirects) break;
      try {
        url = new URL(response.location, url);
      } catch {
        return fail("blocked_url", "That URL redirects somewhere we can't follow.", url.href);
      }
      continue;
    }

    return {
      ok: true,
      status: response.status,
      finalUrl: url.href,
      contentType: response.contentType,
      body: response.bytes.toString("utf8"),
      bytes: response.bytes,
      truncated: response.truncated,
      redirects: hop,
      cacheHeaders: response.cacheHeaders,
    };
  }

  return fail("too_many_redirects", "That URL redirects too many times.", url.href);
}
