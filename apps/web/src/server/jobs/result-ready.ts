import "server-only";

import { createKeyedThrottle, isResultReady } from "@/lib/notification-triggers";
import type { ArmCounts } from "@/lib/verdict";
import { runAfter } from "@/server/email/resend";
import * as triggerRepo from "@/server/repositories/notification-trigger.repository";
import { deliverNotification } from "@/server/services/notification.service";

/**
 * RESULT_READY (spec §5.5): the first time every arm of an ACTIVE experiment passes the
 * `lib/verdict.ts` gate, write the system activity row and email the workspace — once.
 *
 * Two triggers, one code path:
 *
 * - **After ingestion.** `/api/v1/events` calls `scheduleResultReadyCheck` with the experiments a
 *   batch recorded events for. The check runs in `after()`, so the beacon is answered first and
 *   neither a slow query nor an email can delay or fail the recording of an event.
 * - **The daily cron** (`/api/cron/notifications`) sweeps every ACTIVE experiment still unlatched:
 *   the backstop for anything the throttle skipped, a process that died, or a gate crossed while
 *   no further events arrived to trigger a check.
 *
 * "Once" is the database's job, not this module's: `claimResultReady` is a compare-and-set on
 * `Experiment.resultReadyAt`, so any number of concurrent checks — in one process or many — yield
 * one activity row and one notification.
 */

/**
 * How often one process re-checks one experiment after ingestion.
 *
 * In memory, per process — chosen over a database timestamp for three reasons:
 * 1. The throttle only sheds load; the `resultReadyAt` compare-and-set is what guarantees one
 *    email. A process that forgets (restart, overflow, another instance) costs one extra cheap
 *    check, never a duplicate.
 * 2. A database throttle would need a new column (the schema is WP0's) and would itself be a
 *    write on the hot `experiments` row once a minute per experiment — the very load it exists
 *    to avoid.
 * 3. It is the trade `server/http/rate-limit.ts` already makes, for the same reason.
 *
 * A minute because the check is cheap (one indexed lookup; once latched, it matches nothing and
 * stops there; before that, two grouped counts on `(experimentId, variantId)` indexes) and a
 * minute's delay on "a result is ready" is invisible to anyone reading email.
 *
 * The cost of the throttle is latency, not loss: a check that ran just *before* the gate was
 * crossed holds the next one back for up to a minute, and if no further event arrives in that
 * time, the cron finds it.
 */
export const RESULT_CHECK_INTERVAL_MS = 60_000;

const checkThrottle = createKeyedThrottle(RESULT_CHECK_INTERVAL_MS);

/** Experiments whose arms are counted per pair of grouped queries in a sweep. */
const COUNT_CHUNK = 200;

export interface ResultReadySummary {
  /** Unlatched ACTIVE experiments whose counts were evaluated. */
  checked: number;
  /** Experiments this run latched — each wrote one activity row and sent one notification. */
  claimed: number;
  recipients: number;
  sent: number;
  failed: number;
  /** Experiments whose claim or delivery threw; retried by the next run if the claim did not commit. */
  errors: number;
  /** The run stopped at its deadline; the rest are still unlatched and the next run takes them. */
  truncated: boolean;
}

function emptySummary(): ResultReadySummary {
  return { checked: 0, claimed: 0, recipients: 0, sent: 0, failed: 0, errors: 0, truncated: false };
}

/** Control first, then variants in position order — exactly the arms the results page shows. */
function armsOf(
  candidate: triggerRepo.ResultReadyCandidate,
  totals: triggerRepo.ArmTotals | undefined,
): ArmCounts[] {
  const visitors = (key: string | null) => totals?.assigned.get(key) ?? 0;
  const conversions = (key: string | null) => totals?.converted.get(key) ?? 0;
  return [
    { name: "Control", visitors: visitors(null), conversions: conversions(null) },
    ...candidate.variants.map((variant, index) => ({
      name: variant.name.trim() || `Variant ${String.fromCharCode(65 + index)}`,
      visitors: visitors(variant.id),
      conversions: conversions(variant.id),
    })),
  ];
}

async function evaluate(
  candidates: readonly triggerRepo.ResultReadyCandidate[],
  now: Date,
  deadline: number | null,
  summary: ResultReadySummary,
): Promise<void> {
  for (let start = 0; start < candidates.length; start += COUNT_CHUNK) {
    const chunk = candidates.slice(start, start + COUNT_CHUNK);
    const totals = await triggerRepo.countArmTotals(chunk.map((candidate) => candidate.id));

    for (const candidate of chunk) {
      // Checked between experiments, never between a claim and its email: a claim whose email
      // never went out would be a latched experiment nobody was told about.
      if (deadline !== null && Date.now() > deadline) {
        summary.truncated = true;
        return;
      }

      summary.checked += 1;
      const arms = armsOf(candidate, totals.get(candidate.id));
      if (
        !isResultReady({ status: candidate.status, resultReadyAt: candidate.resultReadyAt, arms })
      ) {
        continue;
      }

      try {
        const claimed = await triggerRepo.claimResultReady(candidate.id, now, {
          // What "every version passed" rested on, for anyone auditing the entry later.
          arms: arms.map((arm) => ({
            name: arm.name,
            visitors: arm.visitors,
            conversions: arm.conversions,
          })),
        });
        if (!claimed) continue;
        summary.claimed += 1;

        const delivery = await deliverNotification("RESULT_READY", candidate.website.workspaceId, {
          experimentId: candidate.id,
          experimentName: candidate.name.trim() || "Untitled experiment",
          projectName: candidate.website.name,
        });
        summary.recipients += delivery.recipients;
        summary.sent += delivery.sent;
        summary.failed += delivery.failed;
      } catch (error) {
        summary.errors += 1;
        console.error(`[routely] result-ready check failed for experiment ${candidate.id}:`, error);
      }
    }
  }
}

/**
 * Checks the given experiments now and announces any that just became ready. Delivers the email
 * in the caller's time, so call it from `after()` or a job — never on a request's critical path.
 * Never throws.
 */
export async function checkResultReady(
  experimentIds: readonly string[],
  now: Date = new Date(),
): Promise<ResultReadySummary> {
  const summary = emptySummary();
  if (experimentIds.length === 0) return summary;

  try {
    const candidates = await triggerRepo.listResultReadyCandidates(experimentIds);
    await evaluate(candidates, now, null, summary);
  } catch (error) {
    summary.errors += 1;
    console.error("[routely] result-ready check failed:", error);
  }
  return summary;
}

/**
 * The cron's sweep: every ACTIVE experiment that has not announced a result. Stops claiming new
 * work after `deadline` (epoch ms) and reports `truncated`; unclaimed experiments are simply
 * picked up by the next run. Throws only if the candidate list cannot be read at all.
 */
export async function sweepResultReady(
  options: { now?: Date; deadline?: number } = {},
): Promise<ResultReadySummary> {
  const summary = emptySummary();
  const candidates = await triggerRepo.listResultReadyCandidates();
  await evaluate(candidates, options.now ?? new Date(), options.deadline ?? null, summary);
  return summary;
}

/**
 * Called by `/api/v1/events` with the experiments a batch recorded events for. Synchronous and
 * allocation-light on the request path — a map lookup per experiment — and the database work
 * runs after the response. Each experiment is checked at most once per
 * `RESULT_CHECK_INTERVAL_MS` in this process.
 *
 * Any accepted event triggers it, not only conversions: the gate can be crossed last by a
 * visitor count as easily as by a conversion count (a 20% arm reaches 100 conversions at 500
 * visitors and completes the gate on its 1,000th assignment).
 *
 * Never throws.
 */
export function scheduleResultReadyCheck(experimentIds: readonly string[]): void {
  try {
    const now = Date.now();
    const due = experimentIds.filter((id) => checkThrottle.tryClaim(id, now));
    if (due.length === 0) return;
    runAfter("result-ready check", () => checkResultReady(due));
  } catch (error) {
    console.error("[routely] could not schedule the result-ready check:", error);
  }
}
