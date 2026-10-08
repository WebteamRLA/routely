import "server-only";

import { type DbClient, db } from "@/server/db";
import type { ConfigExperimentRow } from "@/lib/sdk-config";
import type { GoalExperiment, MetricDef } from "@/lib/goal-match";

/**
 * Read paths for the public SDK endpoints — `/api/v1/config` and ingestion.
 *
 * Kept apart from `experiment.repository.ts` (the dashboard's, ownership-scoped by user) because
 * these are scoped by the *website* the public site id resolved to, never by a session, and
 * select only the columns the browser or the matcher needs.
 */

const CONFIG_SELECT = {
  id: true,
  type: true,
  status: true,
  controlUrl: true,
  controlMatchType: true,
  controlWeight: true,
  trafficAllocation: true,
  conversionUrl: true,
  conversionMatchType: true,
  goalMetricId: true,
  targeting: true,
  winnerPosition: true,
  keepWinner: true,
  variants: {
    select: { id: true, position: true, url: true, weight: true, changes: true },
    orderBy: { position: "asc" },
  },
} as const;

/**
 * What the config endpoint may publish for a website: running experiments, and completed Split
 * URL tests that keep redirecting to a winner. Oldest first — the SDK gives the first redirect
 * test claiming a page precedence, as it always has.
 */
export function listConfigExperiments(
  websiteId: string,
  client: DbClient = db,
): Promise<ConfigExperimentRow[]> {
  return client.experiment.findMany({
    where: {
      websiteId,
      OR: [
        { status: "ACTIVE" },
        { status: "ARCHIVED", type: "SPLIT_URL", keepWinner: true, winnerPosition: { gt: 0 } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: CONFIG_SELECT,
  });
}

/** One experiment of this website, whatever its status, for a preview link. */
export function findPreviewExperiment(
  experimentId: string,
  websiteId: string,
  client: DbClient = db,
): Promise<ConfigExperimentRow | null> {
  return client.experiment.findFirst({
    where: { id: experimentId, websiteId },
    select: CONFIG_SELECT,
  });
}

export type IngestExperiment = GoalExperiment & {
  id: string;
  variants: { id: string }[];
};

/**
 * Resolves an experiment during ingestion: it must be ACTIVE and belong to the reporting
 * website. Includes variant ids, so a claimed variant can be checked against *this*
 * experiment's own, and the goal columns the matcher needs.
 */
export function findIngestExperiment(
  experimentId: string,
  websiteId: string,
  client: DbClient = db,
): Promise<IngestExperiment | null> {
  return client.experiment.findFirst({
    where: { id: experimentId, websiteId, status: "ACTIVE" },
    select: {
      id: true,
      goalMetricId: true,
      conversionUrl: true,
      conversionMatchType: true,
      secondaryMetricIds: true,
      variants: { select: { id: true } },
    },
  });
}

/** The website's metrics, for matching `page` and `track` events. */
export function listWebsiteMetrics(websiteId: string, client: DbClient = db): Promise<MetricDef[]> {
  return client.metric.findMany({
    where: { websiteId },
    select: { id: true, kind: true, key: true, url: true, matchType: true, system: true },
  });
}
