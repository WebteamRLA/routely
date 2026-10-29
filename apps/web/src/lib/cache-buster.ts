/**
 * A URL that skips a page cache. Host caches (Nginx, Varnish, LiteSpeed) key on the full URL, so a
 * query parameter they have never seen reaches WordPress itself. The install checks use it for a
 * second look when the plain URL — what visitors get — doesn't carry the project's code: after a
 * snippet change, the cache can keep serving the old page for hours.
 */

export const CACHE_BUSTER_PARAM = "_routely_check";

export function withCacheBuster(url: string, now: number = Date.now()): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(CACHE_BUSTER_PARAM, String(now));
    return parsed.href;
  } catch {
    return url;
  }
}
