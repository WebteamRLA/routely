import "server-only";

import { env } from "@/env";
import { can, rolesWith } from "@/lib/permissions";
import { detectSnippet } from "@/lib/snippet-detect";
import { isSameSite } from "@/lib/url";
import { forbidden, notFound, rateLimited, validationFailed } from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import { type SafeFetchResult, safeFetch } from "@/server/http/safe-fetch";
import * as websiteRepo from "@/server/repositories/website.repository";
import { parseOrThrow } from "@/server/validate";
import { verifyInstallationSchema } from "@/validation/website";

/**
 * Checking whether the tracking snippet is actually on a customer's page.
 *
 * This fetches a URL the customer supplies, which makes it a server-side request forgery
 * vector by construction. The URL must be on the website's own domain (the same `isSameSite`
 * rule experiments are held to, re-applied to every redirect), and the fetch itself goes through
 * `server/http/safe-fetch.ts`: http(s) only, no private address space (checked on the address
 * actually connected to), at most 3 redirects, 5 s and 2 MB. The private-address guard is
 * relaxed outside production only, because local testing targets hosts like `mysite.local` that
 * resolve to loopback by design.
 */

/** Per user. A check is an outbound fetch on the customer's behalf. */
const VERIFY_RATE_LIMIT = 10;
const VERIFY_RATE_WINDOW_MS = 60_000;

export interface InstallationCheck {
  /** The page answered with a non-error status (after redirects). */
  pageLoaded: boolean;
  /** The final response's status, or null when nothing answered (network error, timeout). */
  httpStatus: number | null;
  /** Why the page did not load, safe to show; null when it loaded. */
  loadError: string | null;
  /** This website's snippet (its site id) is in the page. */
  scriptFound: boolean;
  /** The anti-flicker block (`__routelyReveal`) is in the page. */
  antiFlickerFound: boolean;
  /** A Routely snippet is present, but for a different website. */
  wrongSiteId: boolean;
  /**
   * The website's real `lastSeenAt` — when the SDK last reported a page hit. A server-side
   * fetch cannot itself produce an event, so the dialog's "Event received {when}" row shows this
   * and never a fabricated "just now". Null when nothing has reported yet.
   */
  lastSeenAt: Date | null;
  /** Where the check ended up, after any redirects. */
  finalUrl: string;
}

/** Same-site policy for every hop, worded for the install dialog. */
export function sameSitePolicy(domain: string): (url: URL) => string | null {
  return (url) =>
    isSameSite(url.href, domain)
      ? null
      : `That URL leads to ${url.hostname}, which is outside ${domain}.`;
}

/** Private address space is reachable only outside production (local development). */
export function allowPrivateFetch(): boolean {
  return env.NODE_ENV !== "production";
}

/**
 * The customer-facing reading of a fetch: whether the page loaded, and why not.
 * Refusals caused by the URL itself (`blocked_*`, `invalid_url`) are returned as `refused` so
 * the caller can report them as an input error rather than as a site that is down.
 */
export function readFetch(result: SafeFetchResult): {
  pageLoaded: boolean;
  httpStatus: number | null;
  loadError: string | null;
  refused: string | null;
  html: string;
  finalUrl: string;
} {
  if (!result.ok) {
    const refused =
      result.reason === "blocked_url" ||
      result.reason === "blocked_address" ||
      result.reason === "invalid_url"
        ? result.message
        : null;
    return {
      pageLoaded: false,
      httpStatus: null,
      loadError: result.message,
      refused,
      html: "",
      finalUrl: result.url,
    };
  }
  if (result.status >= 400) {
    return {
      pageLoaded: false,
      httpStatus: result.status,
      loadError: `${result.finalUrl} returned HTTP ${result.status}.`,
      refused: null,
      html: "",
      finalUrl: result.finalUrl,
    };
  }
  return {
    pageLoaded: true,
    httpStatus: result.status,
    loadError: null,
    refused: null,
    html: result.body,
    finalUrl: result.finalUrl,
  };
}

/**
 * Checks whether a page carries this website's snippet.
 *
 * A page that fails to load is a result (`pageLoaded: false` with `loadError`), not an error; a
 * URL that is off the website's domain, or resolves to private address space, is refused as a
 * validation error. On success `pixelVerifiedAt` is stamped.
 */
export async function verifyInstallation(
  actorUserId: string,
  input: unknown,
): Promise<InstallationCheck> {
  const { websiteId, url } = parseOrThrow(
    verifyInstallationSchema,
    input,
    "Check the URL you entered.",
  );

  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) {
    throw notFound("That website does not exist.");
  }
  // An outbound fetch on the customer's behalf: Editors and up, not Viewers.
  if (!can(access.role, "pixel.verify")) {
    throw forbidden();
  }
  const { website } = access;

  if (!isSameSite(url, website.domain)) {
    throw validationFailed(
      `Enter a URL on ${website.domain} — that's the domain this website is set up for.`,
      { url: [`Must be a URL on ${website.domain} or one of its subdomains.`] },
    );
  }

  if (!rateLimit(`pixel-verify:${actorUserId}`, VERIFY_RATE_LIMIT, VERIFY_RATE_WINDOW_MS).allowed) {
    throw rateLimited("Too many checks in a minute. Wait a moment and try again.");
  }

  const fetched = readFetch(
    await safeFetch(url, {
      allowUrl: sameSitePolicy(website.domain),
      allowPrivate: allowPrivateFetch(),
    }),
  );

  if (fetched.refused) {
    throw validationFailed(fetched.refused, { url: [fetched.refused] });
  }

  const detection = fetched.pageLoaded
    ? detectSnippet(fetched.html, website.publicSiteId)
    : { scriptFound: false, antiFlickerFound: false, wrongSiteId: false, otherSiteIds: [] };

  // Recorded so the answer survives the dialog being closed. Only a success is written: a
  // failed check may mean the snippet is missing, but it may equally mean the page was slow,
  // behind a login, or cached — none of which is evidence that a previously confirmed
  // installation has gone away, so a failure must not erase one.
  if (detection.scriptFound) {
    await websiteRepo.markPixelVerified(
      website.id,
      actorUserId,
      rolesWith("pixel.verify"),
      new Date(),
    );
  }

  return {
    pageLoaded: fetched.pageLoaded,
    httpStatus: fetched.httpStatus,
    loadError: fetched.loadError,
    ...detection,
    lastSeenAt: website.lastSeenAt,
    finalUrl: fetched.finalUrl,
  };
}
