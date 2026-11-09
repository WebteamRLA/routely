/**
 * URL normalisation and matching.
 *
 * A configured URL is compared against URLs observed in a real browser, where the same page
 * arrives in many spellings: with and without a trailing slash, with a fragment, with campaign
 * parameters appended by an ad network, with a capitalised host. Normalising both sides is
 * what makes `https://acme.com/pricing` and `https://ACME.com/pricing/?utm_source=x#plans`
 * the same page.
 *
 * This mirrors `apps/web/src/lib/url.ts`. The duplication is deliberate — the SDK cannot
 * import from the app, and inlining a shared package would add a module graph to a bundle
 * whose whole point is being one small file. Both copies are covered by the same cases, and a
 * change to either must be mirrored.
 */

import type { UrlMatchType } from "./contract";
import { HANDOFF_PARAMS, HANDOFF_PREFIX, IGNORED_QUERY_PARAMS } from "./contract";

/**
 * Reduces a URL to a comparable form: lowercase host, no fragment, no trailing slash, no
 * tracking or handoff parameters, remaining query parameters sorted.
 *
 * Returns `null` for anything that is not a usable absolute http(s) URL. A URL that cannot be
 * parsed never matches, which means a malformed configuration silently does nothing rather
 * than redirecting a visitor somewhere unintended.
 */
export function normalizeUrl(input: string): string | null {
  let url: URL;

  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => keys.push(key));

  for (const key of keys) {
    if (key.indexOf(HANDOFF_PREFIX) === 0 || IGNORED_QUERY_PARAMS.indexOf(key.toLowerCase()) >= 0) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();

  if (url.pathname !== "/" && url.pathname.charAt(url.pathname.length - 1) === "/") {
    url.pathname = url.pathname.slice(0, -1);
  }

  const query = url.searchParams.toString();
  const path = url.pathname === "/" ? "" : url.pathname;

  return url.protocol + "//" + url.host + path + (query ? "?" + query : "");
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
 *
 * `PREFIX` requires a boundary after the prefix, so an experiment on `/pricing` does not claim
 * `/pricing-old`. Without that, a prefix rule would silently capture unrelated pages that
 * merely start with the same characters.
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
  if (left.indexOf(right) !== 0) return false;

  const rest = left.slice(right.length);
  return rest === "" || rest.charAt(0) === "/" || rest.charAt(0) === "?";
}

/** True when two URLs refer to the same page after normalisation. */
export function isSameUrl(a: string, b: string): boolean {
  const left = pageKey(a);
  return left !== null && left === pageKey(b);
}

/**
 * Copies the identity handoff parameters onto a target URL.
 *
 * The variant page is frequently a different origin (`shop.acme.com` vs `acme.com`), where
 * `localStorage` and host-only cookies do not carry over. Passing the visitor id and the
 * decision in the URL is what keeps one visitor from becoming two at the moment of redirect —
 * and their presence doubles as the marker that stops the variant page redirecting again.
 */
export function withHandoff(
  target: string,
  handoff: { visitorId: string; experimentId: string; variant: string },
): string {
  try {
    const url = new URL(target);
    url.searchParams.set(HANDOFF_PARAMS.visitorId, handoff.visitorId);
    url.searchParams.set(HANDOFF_PARAMS.experimentId, handoff.experimentId);
    url.searchParams.set(HANDOFF_PARAMS.variant, handoff.variant);
    return url.toString();
  } catch {
    return target;
  }
}

/** Reads the handoff parameters from a URL, if it carries a complete set. */
export function readHandoff(
  href: string,
): { visitorId: string; experimentId: string; variant: string } | null {
  try {
    const params = new URL(href).searchParams;
    const visitorId = params.get(HANDOFF_PARAMS.visitorId);
    const experimentId = params.get(HANDOFF_PARAMS.experimentId);
    const variant = params.get(HANDOFF_PARAMS.variant);

    if (!visitorId || !experimentId || !variant) return null;
    return { visitorId, experimentId, variant };
  } catch {
    return null;
  }
}

/** The same URL with every handoff parameter removed, for tidying the address bar. */
export function stripHandoff(href: string): string {
  try {
    const url = new URL(href);
    for (const key of Object.keys(HANDOFF_PARAMS) as (keyof typeof HANDOFF_PARAMS)[]) {
      url.searchParams.delete(HANDOFF_PARAMS[key]);
    }
    return url.toString();
  } catch {
    return href;
  }
}
