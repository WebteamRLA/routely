import "server-only";

import type { DisplayStatusKey, ExperimentKind, ExperimentStatusKey } from "@/lib/domain";
import type {
  ArmView,
  ExperimentResults,
  GoalPerformance,
  GoalView,
  ResultsRange,
} from "@/lib/view-models";
import { db } from "@/server/db";
import {
  armsOf,
  displayStatus,
  kindKey,
  metricGoalView,
  primaryGoalView,
  statusKey,
} from "@/server/mappers";
import { getSharedResults } from "@/server/services/analytics.service";
import { findSharedExperiment } from "@/server/services/experiment.service";

/**
 * Everything the public `/share/[token]` page renders, resolved from the token alone.
 *
 * The token is the authorisation (see `findSharedExperiment`), so nothing here takes an actor —
 * and nothing here reveals more than that one experiment: no account, no project name, no other
 * experiments.
 */
export interface SharedResultsView {
  name: string;
  hypothesis: string;
  status: ExperimentStatusKey;
  displayStatus: DisplayStatusKey;
  type: ExperimentKind;
  url: string;
  winnerPosition: number | null;
  publishedAt: string | null;
  stoppedAt: string | null;
  timezone: string;
  threshold: number;
  coverage: number;
  arms: ArmView[];
  goals: GoalView[];
  results: ExperimentResults;
  goalPerformance: GoalPerformance[] | null;
}

function thresholdFraction(percent: number): number {
  return percent === 90 ? 0.9 : percent === 99 ? 0.99 : 0.95;
}

export async function getSharedResultsView(
  token: string,
  options: { range?: ResultsRange; goal?: string } = {},
): Promise<SharedResultsView | null> {
  const experiment = await findSharedExperiment(token);
  if (!experiment) return null;

  const metricIds = [
    ...(experiment.goalMetricId ? [experiment.goalMetricId] : []),
    ...experiment.secondaryMetricIds,
  ];
  const metrics = await db.metric.findMany({
    where: { websiteId: experiment.websiteId, id: { in: metricIds } },
  });
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const primary = primaryGoalView(experiment, byId);
  const goals: GoalView[] = [
    ...(primary ? [primary] : []),
    ...experiment.secondaryMetricIds.flatMap((id) => {
      const m = byId.get(id);
      return m && id !== experiment.goalMetricId ? [metricGoalView(m)] : [];
    }),
  ];

  const range = options.range ?? "all";
  const [results, goalPerformance] = await Promise.all([
    getSharedResults(experiment, { range, ...(options.goal ? { goal: options.goal } : {}) }),
    goals.length > 1
      ? Promise.all(
          goals.map(async (goal, i) => {
            const r = await getSharedResults(experiment, {
              range,
              goal: goal.key,
              counting: "unique",
            });
            return {
              goal,
              primary: i === 0,
              arms: r.arms.map((a) => ({ position: a.position, v: a.v, c: a.c })),
            };
          }),
        )
      : Promise.resolve(null),
  ]);

  const winnerPosition = experiment.status === "ARCHIVED" ? experiment.winnerPosition : null;
  return {
    name: experiment.name,
    hypothesis: experiment.description ?? "",
    status: statusKey(experiment.status),
    displayStatus: displayStatus(experiment.status, winnerPosition),
    type: kindKey(experiment.type),
    url: experiment.controlUrl,
    winnerPosition,
    publishedAt: experiment.publishedAt?.toISOString() ?? null,
    stoppedAt: experiment.stoppedAt?.toISOString() ?? null,
    timezone: experiment.website.timezone,
    threshold: thresholdFraction(experiment.website.significanceThreshold),
    coverage: experiment.trafficAllocation,
    arms: armsOf(experiment),
    goals,
    results,
    goalPerformance,
  };
}
