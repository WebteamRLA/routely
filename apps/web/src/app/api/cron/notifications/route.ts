import type { NextRequest } from "next/server";

import { env } from "@/env";
import { secretsMatch } from "@/lib/secret-box";
import { type ResultReadySummary, sweepResultReady } from "@/server/jobs/result-ready";
import { pruneVisitorDays, type RetentionSummary } from "@/server/jobs/retention";
import { sweepTrackingStopped, type TrackingStoppedSummary } from "@/server/jobs/tracking-stopped";

/** The Prisma adapter is a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

/**
 * Emails are delivered inside the run (the summary reports them), so it needs longer than a page
 * render. **Check your platform's ceiling for this value** — a value above it is rejected at
 * deploy time. The jobs stop claiming new work at `SWEEP_BUDGET_MS`, below it.
 */
export const maxDuration = 60;

/**
 * Wall-clock budget for claiming new notifications. Checked between items, never between a claim
 * and its email, so a timeout can leave work for the next run but never a latched alert that was
 * not sent.
 */
const SWEEP_BUDGET_MS = 40_000;

type JobOutcome<T> = T | { error: string };

/**
 * The daily notifications sweep (spec §5.5, §1.4):
 *
 * 1. **A result is ready** — the backstop for the after-ingestion check: every ACTIVE experiment
 *    whose arms all passed the gate and that has not announced yet.
 * 2. **Tracking stops** — websites gone quiet for 24 hours with an experiment running.
 * 3. **Retention** — deletes visitor-day rows older than 400 days.
 *
 * Idempotent: every notification is latched by a compare-and-set before it is sent, and the prune
 * deletes by a date cutoff, so a second run — or two at once — sends and deletes nothing more.
 * That is also what makes it safe to call more often than daily from an external scheduler.
 *
 * GET because that is what platform cron schedulers issue; the bearer secret is mandatory for the
 * same reason as `/api/cron/sheets-sync` — this sends email to customers.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const configured = env.CRON_SECRET;

  // Fails closed: an open endpoint would let anyone trigger customer emails.
  if (!configured) {
    console.error("[routely] /api/cron/notifications refused: CRON_SECRET is not set.");
    return json({ error: "not_configured" }, 503);
  }

  const provided = request.headers.get("authorization") ?? "";
  if (!secretsMatch(provided, `Bearer ${configured}`)) {
    return json({ error: "unauthorized" }, 401);
  }

  const now = new Date();
  const deadline = Date.now() + SWEEP_BUDGET_MS;

  // Each job runs regardless of the others: a failing one is reported, not allowed to starve
  // the rest of their daily run.
  const resultReady = await run<ResultReadySummary>("result-ready sweep", () =>
    sweepResultReady({ now, deadline }),
  );
  const trackingStopped = await run<TrackingStoppedSummary>("tracking-stopped sweep", () =>
    sweepTrackingStopped({ now, deadline }),
  );
  const retention = await run<RetentionSummary>("visitor-day prune", () => pruneVisitorDays(now));

  const outcomes = [resultReady, trackingStopped, retention];
  const allFailed = outcomes.every((outcome) => "error" in outcome);

  /*
   * 200 with per-job results when anything ran. Per-item failures are counted inside each summary
   * and retried by the next run; a 500 would tell the scheduler nothing happened, which would be
   * false. Only a run where every job failed to start is an error.
   */
  return json({ resultReady, trackingStopped, retention }, allFailed ? 500 : 200);
}

async function run<T>(label: string, job: () => Promise<T>): Promise<JobOutcome<T>> {
  try {
    return await job();
  } catch (error) {
    console.error(`[routely] cron ${label} failed:`, error);
    return { error: "failed" };
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
