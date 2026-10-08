import "server-only";

/**
 * Server-side favicon detection for a project's domain.
 *
 * Tries three sources at once and keeps the first, in preference order, that answers with an
 * image. The URL is stored, not the bytes — the browser loads it like any other image.
 *
 * Never throws and never takes long: every candidate has a short timeout, they run in
 * parallel, and a project is created whether or not an icon was found (the UI falls back to
 * the project's initial). The candidates are fixed hosts derived from a validated domain, so
 * this is not a general-purpose fetcher; the domain's own `/favicon.ico` is the only request
 * that reaches a customer-controlled host, and it is a GET of a fixed path with no body.
 */

const TIMEOUT_MS = 2_500;

export function faviconCandidates(domain: string): string[] {
  const d = encodeURIComponent(domain);
  return [
    `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${d}.ico`,
    `https://${domain}/favicon.ico`,
  ];
}

async function looksLikeImage(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "RoutelyIconCheck/1 (+https://routely.app)", Accept: "image/*" },
    });
    // Google answers an unknown domain with a 404 and a generic globe; a non-OK status is
    // exactly the "no real icon" signal.
    if (!response.ok) return false;
    const type = response.headers.get("content-type") ?? "";
    const body = await response.arrayBuffer();
    return /^image\//i.test(type) && body.byteLength > 0;
  } catch {
    return false;
  }
}

/** The first candidate that serves an image, or null. Bounded to roughly `TIMEOUT_MS`. */
export async function detectFavicon(domain: string): Promise<string | null> {
  if (!domain || process.env["ROUTELY_DISABLE_FAVICON"] === "true") return null;
  const candidates = faviconCandidates(domain);
  const results = await Promise.all(candidates.map((url) => looksLikeImage(url)));
  const index = results.findIndex(Boolean);
  return index === -1 ? null : candidates[index]!;
}
