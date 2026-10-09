import "server-only";

import type { ExperimentActivity } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/** Experiment activity timeline rows. Written by the experiment service only. */

export function recordActivity(
  data: { experimentId: string; actorName: string | null; text: string },
  client: DbClient = db,
): Promise<ExperimentActivity> {
  return client.experimentActivity.create({ data });
}

/** Newest first. The caller has already resolved the experiment through its owner. */
export function listActivities(
  experimentId: string,
  limit = 100,
  client: DbClient = db,
): Promise<ExperimentActivity[]> {
  return client.experimentActivity.findMany({
    where: { experimentId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * The newest activity rows across every experiment of one website, for the dashboard's feed.
 * Ownership reaches through the experiment to its website, as elsewhere: a website the actor does
 * not own yields nothing.
 */
export function listRecentForWebsite(
  websiteId: string,
  userId: string,
  limit = 6,
  client: DbClient = db,
): Promise<ExperimentActivity[]> {
  return client.experimentActivity.findMany({
    where: { experiment: { websiteId, website: { userId } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}
