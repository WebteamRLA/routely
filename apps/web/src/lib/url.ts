import type { UrlMatchType } from "@/generated/prisma/enums";

/**
 * URL normalisation and matching.
 *
 * Experiment configuration is compared against URLs observed in a browser, where the same
 * page arrives in many spellings: with and without a trailing slash, with a fragment, with
 * campaign parameters, with a capitalised host. Normalising both sides before comparing is
 * what keeps `https://acme.com/pricing` and `https://ACME.com/pricing/#plans` the same page.
 *
 * The SDK carries its own copy of this logic in Part 5 — it cannot import from the app — so
 * any change here must be mirrored there, and both are covered by the same test cases.
 */

/** Query parameters the SDK adds for cross-origin identity handoff. */
const HANDOFF_PREFIX = "_rt_";

/** Tracking parameters that never identify a distinct page. */
const IGNORED_QUERY_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
]);

/**
 * Reduces a URL to a comparable form: lowercase scheme and host, no default port, no
 * fragment, no trailing slash, no tracking or handoff parameters, remaining query parameters
 * sorted. Returns `null` when the input is not a usable absolute http(s) URL.
 */
export function normalizeUrl(input: string): string | null {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(HANDOFF_PREFIX) || IGNORED_QUERY_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();

  // "/" carries no meaning beyond the origin, and "/pricing" must equal "/pricing/".
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  const query = url.searchParams.toString();
  const path = url.pathname === "/" ? "" : url.pathname;

  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}`;
}

/**
 * A page's identity for matching: its normalised URL without the scheme. `http://` and `https://`
 * name the same page for a test (2026-11-09: a test saved as `http://blinto.co/` never matched the
 * `https://` site visitors were on, so it never redirected). Keys and counts still use the full
 * `normalizeUrl`.
 */
function pageKey(url: string): string | null {
  const normal = normalizeUrl(url);
  return normal === null ? null : normal.replace(/^https?:/, "");
}

/**
 * True when `candidate` satisfies a configured URL under the given match type.
 * Unparseable input never matches — a broken URL must not silently redirect a visitor.
 */
export function urlMatches(
  candidate: string,
  configured: string,
  matchType: UrlMatchType,
): boolean {
  const left = pageKey(candidate);
  const right = pageKey(configured);

  if (left === null || right === null) return false;
  if (matchType === "EXACT") return left === right;

  // PREFIX must not treat "/pricing-old" as a match for "/pricing": the next character has
  // to be a boundary, or the candidate has to be the prefix exactly.
  if (!left.startsWith(right)) return false;
  const rest = left.slice(right.length);
  return rest === "" || rest.startsWith("/") || rest.startsWith("?");
}

/** True when two URLs refer to the same page after normalisation. */
export function isSameUrl(a: string, b: string): boolean {
  const left = pageKey(a);
  const right = pageKey(b);
  return left !== null && left === right;
}

/**
 * True when `url` belongs to `domain` — the same host, or a subdomain of it.
 *
 * This is the "safe same-site rule": an experiment may point at `acme.com`,
 * `www.acme.com` or `shop.acme.com` when the website's domain is `acme.com`, but not at
 * `notacme.com` or `acme.com.evil.test`.
 *
 * The suffix check is anchored on a dot for exactly that reason — a bare `endsWith(domain)`
 * would accept `evil-acme.com`, and `includes(domain)` would accept `acme.com.evil.test`.
 * Getting this wrong would let one customer point an experiment at somebody else's site and
 * redirect their visitors.
 */
export function isSameSite(url: string, domain: string): boolean {
  let host: string;

  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }

  const base = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!base) return false;

  return host === base || host.endsWith(`.${base}`);
}

/**
 * True when two experiments could both claim the same page view.
 *
 * Exact-vs-exact is a plain equality check, but a `PREFIX` control URL widens the claim: an
 * experiment on `/pricing` with PREFIX matching also owns `/pricing/plans`, so it conflicts
 * with an experiment configured for that deeper page. Two experiments that both match a page
 * would each try to redirect the same visitor, and which one won would come down to ordering.
 */
export function controlUrlsConflict(
  a: { url: string; match: UrlMatchType },
  b: { url: string; match: UrlMatchType },
): boolean {
  const left = normalizeUrl(a.url);
  const right = normalizeUrl(b.url);

  if (left === null || right === null) return false;
  if (left === right) return true;

  // A prefix-matching control claims everything beneath it, so check each side's claim
  // against the other's specific URL.
  return (
    (a.match === "PREFIX" && urlMatches(right, a.url, "PREFIX")) ||
    (b.match === "PREFIX" && urlMatches(left, b.url, "PREFIX"))
  );
}
