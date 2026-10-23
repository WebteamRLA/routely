import type { NextRequest } from "next/server";

import { isBot } from "@/server/http/bot-filter";
import { clientAddress, rateLimit } from "@/server/http/rate-limit";
import { recordHit } from "@/server/services/ingest.service";

/**
 * The SDK's site-wide page hit.
 *
 *   POST /api/v1/hit      body: {"v":4,"siteId":"rt_…","anonymousId":"…","url":"…","ts":…}
 *
 * Sent with `sendBeacon` as `text/plain` on every page carrying the snippet, at most once per
 * normalised URL per UTC day per browser. It feeds tracking status (`Website.lastSeenAt`), daily
 * visitors and page baselines. Unauthenticated, like `/events`, and handled the same way: the
 * transport concerns live here (body size, bot filter, rate limit, CORS) and every trust rule in
 * `ingest.service.recordHit`.
 */

/** The Prisma adapter uses a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

/** A hit is ~200 bytes; anything near this is not one. */
const MAX_BODY_BYTES = 4 * 1024;

/**
 * Per-IP, per-site. A browser sends at most one hit per page per day, so even a visitor
 * reading a whole catalogue stays far below this; a script replaying hits does not.
 */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

/** Same reasoning as `/api/v1/events`: no data in the response, no cookies read. */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Max-Age": "86400",
} as const;

/** Every outcome is `204` (except `429`): a beacon can neither retry nor act on an error. */
function accepted() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  // A crawler rendering pages is not a visitor, and must not make a site look tracked.
  if (isBot(request.headers.get("user-agent"))) return accepted();

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return accepted();

  let payload: unknown;
  try {
    // text/plain keeps the beacon CORS-simple, so the body is parsed here whatever its type.
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return accepted();
    payload = JSON.parse(text);
  } catch {
    return accepted();
  }

  const siteId =
    typeof payload === "object" && payload !== null && "siteId" in payload
      ? String((payload as { siteId: unknown }).siteId).slice(0, 64)
      : "unknown";

  const limit = rateLimit(
    `hit:${siteId}:${clientAddress(request.headers)}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    return new Response(null, {
      status: 429,
      headers: { ...CORS_HEADERS, "Retry-After": String(limit.retryAfter) },
    });
  }

  try {
    await recordHit(payload);
  } catch (error) {
    // Never surfaces on a customer's page.
    console.error("[routely] hit failed", error);
  }

  return accepted();
}
