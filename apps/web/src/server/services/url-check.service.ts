import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { env } from "@/env";
import { isPrivateAddress } from "@/lib/private-address";
import type { UrlCheckResult } from "@/lib/view-models";
import { rateLimited } from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import { onProjectDomain } from "@/server/mappers";
import { projectDomains, requireProject } from "@/server/services/website.service";
import { absoluteUrlSchema } from "@/validation/common";

/**
 * "Is this URL reachable?" for the wizard's URL fields and QA checks.
 *
 * A server-side fetch of a customer-supplied URL is an SSRF vector by construction, so:
 *
 *  1. **Private address space is refused**, checked on the *resolved* address of every hop
 *     (a name like `metadata.internal` resolves to 169.254.169.254 just as well). In
 *     development, hosts on the project's own domains are exempt so local sites (resolving to
 *     loopback) can be tested; everything else is checked everywhere.
 *  2. **Redirects are followed manually** (max 5), re-checking each hop.
 *  3. **Bounded**: 5 s per request, HEAD first; GET only as a fallback or to look for the
 *     snippet, reading at most 512 KB.
 *  4. **Rate limited** per user (30/min), so it cannot be used as a scanner.
 *
 * Only the status is reported — never the body — so the endpoint leaks nothing about pages it
 * can reach beyond "reachable".
 */

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 512 * 1024;

async function addressAllowed(url: URL, exempt: boolean): Promise<boolean> {
  if (exempt) return true;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const address = isIP(host)
    ? host
    : await lookup(host).then(
        (result) => result.address,
        () => null,
      );
  return address !== null && !isPrivateAddress(address);
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (total >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

type Hop = { response: Response; url: URL } | { error: string };

async function request(
  start: URL,
  method: "HEAD" | "GET",
  isExempt: (url: URL) => boolean,
): Promise<Hop> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!(await addressAllowed(url, isExempt(url)))) {
      return { error: `${url.hostname} resolves to a private or unknown address.` };
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": "RoutelyUrlCheck/1 (+https://routely.app)",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
      });
    } catch {
      return { error: `We couldn't reach ${url.hostname}.` };
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url);
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        return { error: "That URL redirects somewhere we can't follow." };
      }
      await response.body?.cancel().catch(() => {});
      url = next;
      continue;
    }
    return { response, url };
  }
  return { error: "That URL redirects too many times." };
}

export async function checkUrl(
  actorUserId: string,
  projectId: string,
  rawUrl: unknown,
): Promise<UrlCheckResult> {
  const started = Date.now();
  const project = await requireProject(actorUserId, projectId);
  const domains = projectDomains(project);
  const done = (partial: Partial<UrlCheckResult>): UrlCheckResult => ({
    ok: false,
    status: null,
    finalUrl: null,
    onProjectDomain: false,
    snippetFound: null,
    message: null,
    ...partial,
    elapsedMs: Date.now() - started,
  });

  const parsed = absoluteUrlSchema.safeParse(rawUrl);
  if (!parsed.success) {
    return done({ message: parsed.error.issues[0]?.message ?? "Enter a full URL." });
  }

  if (!rateLimit(`url-check:${actorUserId}`, 30, 60_000).allowed) {
    throw rateLimited("Too many URL checks. Wait a minute and try again.");
  }

  const url = new URL(parsed.data);
  const onDomain = onProjectDomain(url.href, domains);
  const isExempt = (candidate: URL) =>
    env.NODE_ENV !== "production" && onProjectDomain(candidate.href, domains);

  // On the project's own domains a GET also tells us whether the snippet is installed there.
  let hop = await request(url, onDomain ? "GET" : "HEAD", isExempt);
  if (
    !onDomain &&
    "response" in hop &&
    (hop.response.status === 405 || hop.response.status === 501 || hop.response.status === 403)
  ) {
    hop = await request(url, "GET", isExempt);
  }
  if ("error" in hop) {
    return done({ onProjectDomain: onDomain, message: hop.error });
  }

  const { response, url: finalUrl } = hop;
  let snippetFound: boolean | null = null;
  if (onDomain && response.ok && response.body) {
    snippetFound = (await readCapped(response)).includes(project.publicSiteId);
  } else {
    await response.body?.cancel().catch(() => {});
  }

  return done({
    ok: response.ok,
    status: response.status,
    finalUrl: finalUrl.href,
    onProjectDomain: onProjectDomain(finalUrl.href, domains),
    snippetFound,
    message: response.ok ? null : `The page answered HTTP ${response.status}.`,
  });
}
