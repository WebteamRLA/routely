/**
 * URL and domain helpers ported verbatim from the design prototype.
 *
 * Client-safe and dependency-free. These are the *display and form-validation* semantics the
 * wizard and project forms use; server-side URL normalisation for tracking lives in `url.ts`
 * (mirrored by the SDK) and is deliberately not shared with this module.
 */

/** A full http(s) URL with a dotted host: what every URL field in the wizard requires. */
export const URL_RE = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;

/** A bare, normalised domain (optionally with a port), as produced by `normDomain`. */
export const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/;

/**
 * Reduces whatever someone typed into a website field to a bare domain: trims, lowercases,
 * strips the protocol, a leading `www.`, and anything from the first `/`, `?` or `#`.
 * `"https://www.Example.com/pricing?x=1"` → `"example.com"`.
 */
export function normDomain(input: unknown): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

/** Whether a (normalised) domain is acceptable: dotted labels, optional port. */
export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

/** `host` (with port) of a URL, or `""` when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Path plus query of a URL; the input itself (or `""`) when it does not parse. */
export function pathOf(url: string): string {
  try {
    const x = new URL(url);
    return x.pathname + x.search;
  } catch {
    return url || "";
  }
}

/**
 * The comparison form used by targeting and validation: protocol, query and one trailing
 * slash removed. `"https://a.com/x/?q=1"` → `"a.com/x"`.
 */
export function stripU(x: unknown): string {
  return String(x || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .split("?")[0]!
    .replace(/\/$/, "");
}

/** Whether `host` is one of `domains` or a subdomain of one. */
export function isKnownHost(host: string, domains: readonly string[]): boolean {
  return !!host && domains.some((d) => host === d || host.endsWith(`.${d}`));
}
