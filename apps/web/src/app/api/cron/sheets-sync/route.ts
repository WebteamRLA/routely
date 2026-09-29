import type { NextRequest } from "next/server";

import { env } from "@/env";
import { secretsMatch } from "@/lib/secret-box";
import { isAppError } from "@/server/errors";
import { refreshAllSheets } from "@/server/services/sheets-sync.service";

/** The Prisma adapter is a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

/**
 * A sweep visits every connection and makes several network round trips per connection, so it
 * needs materially longer than a page render.
 *
 * The service enforces its own wall-clock budget (`SWEEP_BUDGET_MS`) below this, and stops
 * claiming new work rather than being killed part-way through an append — being killed mid-append
 * is precisely what produces a run whose outcome nobody knows.
 *
 * **Check your platform's ceiling for this value.** Vercel's maximum duration differs by plan and
 * has changed more than once; a value above the ceiling is rejected at deploy time rather than
 * silently clamped.
 */
export const maxDuration = 60;

/**
 * The scheduled refresh.
 *
 * Traffic already keeps a busy website's spreadsheet current, so this exists for the quiet ones:
 * without it, a site with no visitors would keep showing whatever it last showed and its window
 * would never roll forward onto the new day.
 *
 * GET, because that is what platform cron schedulers issue. It is not a "read" — it writes to
 * customers' spreadsheets — which is exactly why the shared secret is mandatory rather than
 * advisory.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const configured = env.CRON_SECRET;

  /*
   * Refuses rather than running openly. An unauthenticated endpoint here is not merely a data leak:
   * anyone could make Routely write to customers' spreadsheets, repeatedly. Missing configuration
   * therefore fails closed, and says so in the log so the cause is findable.
   */
  if (!configured) {
    console.error("[routely] /api/cron/sheets-sync refused: CRON_SECRET is not set.");
    return json({ error: "not_configured" }, 503);
  }

  const provided = request.headers.get("authorization") ?? "";

  // Hashed inside `secretsMatch`, so the comparison is constant-time and cannot leak the expected
  // length through either an exception or timing.
  if (!secretsMatch(provided, `Bearer ${configured}`)) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const summary = await refreshAllSheets();

    /*
     * 200 with counts, even when some connections failed.
     *
     * A per-website failure is recorded on that website's own row and retried by the next run, and
     * a 500 here would tell the scheduler the whole job failed — obscuring which customers *were*
     * written. Only a run that could not start at all is an error.
     */
    return json(summary, 200);
  } catch (error) {
    console.error(
      "[routely] scheduled sheet refresh could not start:",
      isAppError(error) ? error.message : error,
    );

    return json({ error: "sweep_failed" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Nothing should cache a job's result.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
