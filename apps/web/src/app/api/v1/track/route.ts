import { after, type NextRequest } from "next/server";

import { isBot } from "@/server/http/bot-filter";
import { clientAddress, rateLimit } from "@/server/http/rate-limit";
import { scheduleResultReadyCheck } from "@/server/jobs/result-ready";
import { ingestCustomEvents } from "@/server/services/ingest.service";
import { refreshSheet } from "@/server/services/sheets-sync.service";

/**
 * Custom events from the tracking SDK.
 *
 *   POST /api/v1/track     body: {"v":5,"siteId":"rt_…","visitorId":"…","events":[…],"issues":[…]}
 *
 * Handled exactly as `/api/v1/events`: unauthenticated because a script in a visitor's browser
 * calls it, transport concerns here, every trust rule in `ingest.service.ingestCustomEvents`, and
 * `204` for every outcome but `429`, because a beacon can neither retry nor act on an error.
 */

/** The Prisma adapter uses a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

/** Twenty events with full properties fit comfortably; more is not a batch. */
const MAX_BODY_BYTES = 32 * 1024;

/** Per IP and site. A person clicks far below this; a loop or a replayed script does not. */
const RATE_LIMIT = 120;
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
  if (isBot(request.headers.get("user-agent"))) return accepted();

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return accepted();

  let payload: unknown;
  try {
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
    `track:${siteId}:${clientAddress(request.headers)}`,
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
    const result = await ingestCustomEvents(payload);

    // As `/api/v1/events`: only after the response, and only when a number actually moved.
    if (result.websiteId && result.experimentIds.length > 0) {
      const websiteId = result.websiteId;
      after(() => refreshSheet(websiteId));
      scheduleResultReadyCheck(result.experimentIds);
    }
  } catch (error) {
    // A failure here must never surface on a customer's page.
    console.error("[routely] custom event ingestion failed", error);
  }

  return accepted();
}
