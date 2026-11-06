import type { NextRequest } from "next/server";

import { clientAddress, rateLimit } from "@/server/http/rate-limit";
import { recordVerifySignal } from "@/server/services/install-verification.service";

/**
 * The SDK's answer to an install check.
 *
 *   POST /api/v1/verify    body: {"v":5,"token":"…","stage":"ready","siteIds":["rt_…"],"url":"…"}
 *
 * Unauthenticated, like the other SDK endpoints, and useless without a live token, which only the
 * dashboard user who started the check has. No bot filter: this request exists because a person
 * asked for it, and the token already says so.
 */

/** The Prisma adapter uses a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Max-Age": "86400",
} as const;

function accepted() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return accepted();

  const limit = rateLimit(`verify:${clientAddress(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return new Response(null, {
      status: 429,
      headers: { ...CORS_HEADERS, "Retry-After": String(limit.retryAfter) },
    });
  }

  try {
    const text = await request.text();
    if (text.length <= MAX_BODY_BYTES) await recordVerifySignal(JSON.parse(text));
  } catch (error) {
    if (!(error instanceof SyntaxError)) console.error("[routely] verify signal failed", error);
  }

  return accepted();
}
