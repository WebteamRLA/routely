import "server-only";

import { trackingAlertDecision, trackingStoppedCutoff } from "@/lib/notification-triggers";
import * as triggerRepo from "@/server/repositories/notification-trigger.repository";
import { deliverNotification } from "@/server/services/notification.service";

/**
 * TRACKING_STOPPED (spec §5.5): a website whose tracking badge has gone from "Active" to "Not
 * seen" while an experiment is running there — once per outage.
 *
 * Cron only. Detecting an *absence* of hits needs a clock, not a request, and putting any of this
 * on the hit path would add work to the one endpoint every page of every customer calls.
 *
 * The latch is `Website.trackingAlertSentAt`, taken with a compare-and-set before the email. It
 * re-arms when hits resume: a hit after the alert moves `lastSeenAt` past it. The sweep also
 * clears such latches first, so the column reads as "an alert is outstanding for the current
 * outage" — the hit path itself is untouched.
 */

export interface TrackingStoppedSummary {
  /** Latches cleared because hits resumed since the alert. */
  rearmed: number;
  /** Websites quiet past the threshold with a running experiment and no alert since their last hit. */
  candidates: number;
  /** Websites this run latched — one notification each. */
  alerted: number;
  recipients: number;
  sent: number;
  failed: number;
  errors: number;
  truncated: boolean;
}

/**
 * Throws only if the candidate list cannot be read at all; a failure on one website is counted
 * and the sweep moves on.
 */
export async function sweepTrackingStopped(
  options: { now?: Date; deadline?: number } = {},
): Promise<TrackingStoppedSummary> {
  const now = options.now ?? new Date();
  const summary: TrackingStoppedSummary = {
    rearmed: 0,
    candidates: 0,
    alerted: 0,
    recipients: 0,
    sent: 0,
    failed: 0,
    errors: 0,
    truncated: false,
  };

  try {
    summary.rearmed = await triggerRepo.rearmTrackingAlerts();
  } catch (error) {
    // Housekeeping only — the latch re-arms on its own — so it never blocks the alerts.
    summary.errors += 1;
    console.error("[routely] could not re-arm tracking alerts:", error);
  }

  const cutoff = trackingStoppedCutoff(now);
  const candidates = await triggerRepo.listTrackingAlertCandidates(cutoff);
  summary.candidates = candidates.length;

  for (const website of candidates) {
    if (options.deadline !== undefined && Date.now() > options.deadline) {
      summary.truncated = true;
      break;
    }

    const decision = trackingAlertDecision(
      {
        lastSeenAt: website.lastSeenAt,
        pixelVerifiedAt: website.pixelVerifiedAt,
        trackingAlertSentAt: website.trackingAlertSentAt,
        activeExperiments: website._count.experiments,
      },
      now,
    );
    if (decision !== "send" || website.lastSeenAt === null) continue;

    try {
      if (!(await triggerRepo.claimTrackingAlert(website.id, cutoff, now))) continue;
      summary.alerted += 1;

      const delivery = await deliverNotification("TRACKING_STOPPED", website.workspaceId, {
        websiteId: website.id,
        projectName: website.name,
        domain: website.domain,
        lastSeenAt: website.lastSeenAt,
      });
      summary.recipients += delivery.recipients;
      summary.sent += delivery.sent;
      summary.failed += delivery.failed;
    } catch (error) {
      summary.errors += 1;
      console.error(`[routely] tracking-stopped alert failed for website ${website.id}:`, error);
    }
  }

  return summary;
}
