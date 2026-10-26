import type { NextRequest } from "next/server";

import { isBot } from "@/server/http/bot-filter";
import { clientAddress, rateLimit } from "@/server/http/rate-limit";
import { assignForVisitor } from "@/server/services/ingest.service";

/**
 * A new visitor's arm in an experiment.
 *
 *   POST /api/v1/assign   body: {"v":4,"siteId":"rt_…","visitorId":"…","experimentId":"…"}
 *   200 {"variantId":"…"|null}   — the arm (null is control), new or the one already stored
 *   204                          — not entered (unknown, paused, malformed, a bot)
 *
 * Called by the SDK once per visitor per experiment, only when it has no stored arm; a refresh or a
 * return visit reads the stored arm and never comes here. The server chooses the arm so it can
 * balance the split (`lib/balance.ts`); the trust rules live in `ingest.service.assignForVisitor`.
 *
 * `text/plain` keeps the request CORS-simple (no preflight before a redirect decision), and the
 * response carries nothing but the arm, so any origin may read it.
 */

/** The Prisma adapter uses a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A request is ~150 bytes. */
const MAX_BODY_BYTES = 2 * 1024;

/**
 * Per-IP, per-site. A browser asks once per experiment it is entered in; an office behind one
 * address stays well under this, a script inventing visitors to skew a split does not.
 */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
} as const;

function notEntered() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  // A crawler is not a visitor: it must not take a place in the split.
  if (isBot(request.headers.get("user-agent"))) return notEntered();

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return notEntered();

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return notEntered();
    payload = JSON.parse(text);
  } catch {
    return notEntered();
  }

  const siteId =
    typeof payload === "object" && payload !== null && "siteId" in payload
      ? String((payload as { siteId: unknown }).siteId).slice(0, 64)
      : "unknown";
  const limit = rateLimit(
    `assign:${siteId}:${clientAddress(request.headers)}`,
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
    const assigned = await assignForVisitor(payload);
    if (!assigned) return notEntered();
    return Response.json(assigned, { headers: CORS_HEADERS });
  } catch (error) {
    // The SDK treats any failure as "not entered" and leaves the page alone.
    console.error("[routely] assign failed", error);
    return new Response(null, { status: 503, headers: CORS_HEADERS });
  }
}
