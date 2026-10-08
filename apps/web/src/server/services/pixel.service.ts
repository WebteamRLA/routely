import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { env } from "@/env";
import { isPrivateAddress } from "@/lib/private-address";
import { isSameSite } from "@/lib/url";
import { notFound, validationFailed } from "@/server/errors";
import * as eventRepo from "@/server/repositories/event.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { parseOrThrow } from "@/server/validate";
import { verifyInstallationSchema } from "@/validation/website";

/**
 * Checking whether the tracking snippet is actually on a customer's page.
 *
 * This fetches a URL the customer supplies, which makes it a server-side request forgery
 * vector by construction: without limits it is a general-purpose "make the Routely server
 * request this for me" endpoint, reachable from any signed-in account. Four constraints keep
 * it narrow, and each covers something the others do not:
 *
 *  1. **Same-site.** The URL must be on the website's own registered domain, reusing the same
 *     `isSameSite` rule experiments are held to. That alone limits an attacker to hosts they
 *     have already claimed as theirs.
 *  2. **No private address space** (production only). A domain is just a name, and
 *     `169.254.169.254` or an internal host is perfectly registrable — so the resolved address
 *     is checked, not the name. Skipped in development because local testing runs against
 *     hosts like `mysite.local` that resolve to loopback by design.
 *  3. **Redirects are followed manually**, re-validating every hop. Following automatically
 *     would let a compliant first response bounce the request somewhere the checks above just
 *     rejected.
 *  4. **Bounded time and size**, so a slow or enormous response cannot tie up the server.
 */

/** Long enough for a slow origin, short enough that the form does not appear to hang. */
const FETCH_TIMEOUT_MS = 8_000;

/** The snippet belongs in `<head>`, so the opening bytes are always enough to find it. */
const MAX_BYTES = 512 * 1024;

/** Enough to cover http→https and apex→www, without becoming a redirect crawler. */
const MAX_REDIRECTS = 3;

export interface InstallationCheck {
  /** The snippet was found carrying this website's public site id. */
  snippetFound: boolean;
  /** A Routely snippet is present, but for a different website. */
  wrongSiteId: boolean;
  /** Whether the ingestion endpoint has ever recorded an event for this website. */
  receivingData: boolean;
  /** Where the check ended up, after any redirects. */
  finalUrl: string;
}

/** Rejects a URL whose host resolves into address space this endpoint must not reach. */
async function assertPublicHost(url: URL): Promise<void> {
  // Local development legitimately targets hosts that resolve to loopback — a WordPress site
  // at `mysite.local`, for instance — so the address check would make the feature untestable.
  if (env.NODE_ENV !== "production") return;

  const literal = isIP(url.hostname);
  const address = literal
    ? url.hostname
    : await lookup(url.hostname).then(
        (result) => result.address,
        () => null,
      );

  if (!address) {
    throw validationFailed(`We couldn't resolve ${url.hostname}. Check the address and try again.`);
  }

  if (isPrivateAddress(address)) {
    throw validationFailed(
      `${url.hostname} resolves to a private address, so we can't reach it from here.`,
    );
  }
}

/** Fetches up to `MAX_BYTES` of a response body, so an enormous page cannot exhaust memory. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      if (total >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return chunks.join("");
}

/**
 * Follows redirects by hand so each hop is re-validated. `redirect: "manual"` is what makes
 * that possible — the automatic mode would resolve the chain internally and only hand back the
 * final response, by which point an off-limits host has already been contacted.
 */
async function fetchHtml(
  startUrl: URL,
  domains: string[],
): Promise<{ html: string; finalUrl: URL }> {
  const domain = domains.join(", ");
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          // Some hosts serve a different document, or none at all, without these.
          "User-Agent": "RoutelyInstallCheck/1 (+https://routely.app)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      throw validationFailed(
        `We couldn't load ${url.href}. Check the site is running and reachable from this machine.`,
      );
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url);

      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw validationFailed("That URL redirects somewhere we can't follow.");
      }
      // A redirect off the website's own domain is where a benign-looking URL would otherwise
      // become a request to anywhere at all.
      if (!domains.some((d) => isSameSite(next.href, d))) {
        throw validationFailed(
          `That URL redirects to ${next.hostname}, which is outside ${domain}.`,
        );
      }

      url = next;
      continue;
    }

    if (!response.ok) {
      throw validationFailed(
        `${url.href} returned HTTP ${response.status}. We need a page we can load to check it.`,
      );
    }

    return { html: await readCapped(response), finalUrl: url };
  }

  throw validationFailed("That URL redirects too many times.");
}

/**
 * Checks whether a page carries this website's snippet.
 *
 * Deliberately looks for the **site id**, not the script URL: the id is what actually binds a
 * page to this website, and it is present however the tag was written — hand-pasted, injected
 * by a plugin, or reformatted by a minifier.
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

  const website = await websiteRepo.findProjectForUser(websiteId, actorUserId);
  if (!website) {
    throw notFound("That website does not exist.");
  }

  // The primary domain and every additional domain of the project.
  const domains = [website.domain, ...website.domains.map((row) => row.domain)];
  if (!domains.some((d) => isSameSite(url, d))) {
    const list = domains.join(" or ");
    throw validationFailed(`Enter a URL on ${list} — that's where this project is set up.`, {
      url: [`Must be a URL on ${list} or one of their subdomains.`],
    });
  }

  const { html, finalUrl } = await fetchHtml(new URL(url), domains);

  const snippetFound = html.includes(website.publicSiteId);
  // A page carrying some other site's id is the most common install mistake worth naming:
  // the snippet was copied from a different website in the same account.
  const wrongSiteId = !snippetFound && /data-site-id\s*=\s*["']rt_/i.test(html);

  // Recorded so the answer survives the dialog being closed. Only a success is written: a
  // failed check may mean the snippet is missing, but it may equally mean the page was slow,
  // behind a login, or cached — none of which is evidence that a previously confirmed
  // installation has gone away, so a failure must not erase one.
  if (snippetFound) {
    await websiteRepo.markPixelVerified(website.id, actorUserId, new Date());
  }

  return {
    snippetFound,
    wrongSiteId,
    receivingData: await eventRepo.hasEvents(website.id),
    finalUrl: finalUrl.href,
  };
}
