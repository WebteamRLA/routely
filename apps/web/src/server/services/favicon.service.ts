import "server-only";

import { type IconType, faviconCandidates, sniffImageType } from "@/lib/favicon";
import { safeFetch } from "@/server/http/safe-fetch";
import * as websiteRepo from "@/server/repositories/website.repository";
import { allowPrivateFetch } from "@/server/services/pixel.service";

/**
 * A project's favicon, for the tiles on the dashboard, the Projects list and the project page.
 *
 * Fetched by Routely's server through `safeFetch` (the same SSRF guard as the install check), not
 * by the viewer's browser from a third-party favicon service: that would hand every customer's
 * project domains to someone else. The homepage is read for its `<link rel="icon">` declarations,
 * then each candidate is tried until one is a real bitmap (`lib/favicon.ts`).
 *
 * Remembered per server instance for a few hours, found or not, so a dashboard of ten tiles does
 * not fetch ten homepages on every view; browsers cache the answer for a day on top of that.
 */

export interface Favicon {
  type: IconType;
  bytes: Buffer;
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; icon: Favicon | null }>();

const PAGE_MAX_BYTES = 512 * 1024;
const ICON_MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 4_000;

/** Null when the actor cannot see the project, or it has no usable icon. */
export async function projectFavicon(
  actorUserId: string,
  websiteId: string,
  now: number = Date.now(),
): Promise<Favicon | null> {
  const website = await websiteRepo.findWebsiteForUser(websiteId, actorUserId);
  if (!website) return null;

  const home = `${website.protocol === "HTTP" ? "http" : "https"}://${website.domain}/`;
  const hit = cache.get(home);
  if (hit && now - hit.at < CACHE_MS) return hit.icon;

  const icon = await findFavicon(home);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(home, { at: now, icon });
  return icon;
}

async function findFavicon(home: string): Promise<Favicon | null> {
  const allowPrivate = allowPrivateFetch();
  const page = await safeFetch(home, {
    maxBytes: PAGE_MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    allowPrivate,
  });
  const candidates =
    page.ok && page.status < 400
      ? faviconCandidates(page.body, page.finalUrl)
      : faviconCandidates("", home);

  for (const url of candidates) {
    const response = await safeFetch(url, {
      maxBytes: ICON_MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      allowPrivate,
      accept: "image/avif,image/webp,image/png,image/*;q=0.8",
    });
    if (!response.ok || response.status !== 200 || response.truncated) continue;
    const type = sniffImageType(response.bytes);
    if (type) return { type, bytes: response.bytes };
  }
  return null;
}
