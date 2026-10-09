import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { ActivityRow } from "@/components/experiments/detail/activity-tab";
import { ExperimentDetailView } from "@/components/experiments/detail/experiment-detail";
import type { ResultsMeta } from "@/components/results/model";
import { dayKey, timingText } from "@/components/results/timing";
import { demoState } from "@/lib/demo-state";
import { armName } from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { fDate } from "@/lib/format";
import type { ExperimentDetailTab } from "@/lib/routes";
import { computeStats } from "@/lib/stats";
import { defaultWinner, verdict } from "@/lib/verdict";
import type { ExperimentDetail, GoalPerformance, ResultsRange } from "@/lib/view-models";
import { requireSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as analyticsService from "@/server/services/analytics.service";
import * as experimentService from "@/server/services/experiment.service";
import { getProject } from "@/server/services/website.service";

export const metadata: Metadata = { title: "Experiment" };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const TABS: ExperimentDetailTab[] = ["results", "setup", "activity"];
const RANGES: ResultsRange[] = ["7", "14", "30", "all"];

function completedText(d: ExperimentDetail): string {
  const w = d.winnerPosition;
  if (w != null && w > 0) {
    const arm = d.arms.find((a) => a.position === w);
    const path = d.type === "redirect" && arm ? ` (${pathOf(arm.url)})` : "";
    return `Next step: make ${armName(w)} permanent on your site${path}, then archive this experiment.`;
  }
  return "Visitors now see Control. Consider a bolder variant for the next round.";
}

export default async function ExperimentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; experimentId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ projectId, experimentId }, sp, session] = await Promise.all([
    params,
    searchParams,
    requireSession(),
  ]);
  const actor = session.user.id;
  const rawTab = first(sp.tab) as ExperimentDetailTab | undefined;
  const rawRange = first(sp.range) as ResultsRange | undefined;
  const range: ResultsRange = rawRange && RANGES.includes(rawRange) ? rawRange : "all";
  const goalParam = first(sp.goal)?.slice(0, 100);

  let project;
  let detail;
  try {
    [project, detail] = await Promise.all([
      getProject(actor, projectId),
      experimentService.getExperimentDetail(actor, projectId, experimentId),
    ]);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const draft = detail.status === "draft";
  const tab: ExperimentDetailTab = draft
    ? "setup"
    : rawTab && TABS.includes(rawTab)
      ? rawTab
      : "results";
  const goals = [...(detail.goal ? [detail.goal] : []), ...detail.secondaryGoals].filter(
    (g, i, all) => all.findIndex((x) => x.key === g.key) === i,
  );

  let results = null;
  let goalPerformance: GoalPerformance[] | null = null;
  if (tab === "results") {
    [results, goalPerformance] = await Promise.all([
      analyticsService.getExperimentResults(actor, projectId, experimentId, {
        range,
        ...(goalParam ? { goal: goalParam } : {}),
      }),
      goals.length > 1
        ? analyticsService.getGoalPerformance(actor, projectId, experimentId, range)
        : Promise.resolve(null),
    ]);
  }

  const meta: ResultsMeta = {
    status: detail.status,
    type: detail.type,
    winnerPosition: detail.winnerPosition,
    arms: detail.arms,
    coverage: detail.coverage,
    threshold: project.threshold,
    goals,
  };

  // All-time primary-goal stats for the End modal and its preselected outcome.
  const totals = [...detail.totals].sort((a, b) => a.position - b.position);
  const endStats = computeStats(totals.map((t) => ({ name: armName(t.position), v: t.v, c: t.c })));
  const endWinner = defaultWinner(
    verdict(detail.status, detail.winnerPosition, endStats, project.threshold),
  );

  const now = new Date();
  const today = dayKey(now, project.timezone);
  const activity: ActivityRow[] = detail.activities.map((a) => ({
    id: a.id,
    when:
      dayKey(a.createdAt, project.timezone) === today
        ? "Today"
        : fDate(a.createdAt, project.timezone),
    text: a.text,
    who: a.actorName ?? "Routely",
  }));

  return (
    <ExperimentDetailView
      projectId={project.id}
      projectName={project.name}
      detail={detail}
      tab={tab}
      timing={timingText(detail, project.timezone, now)}
      completedText={completedText(detail)}
      meta={meta}
      results={results}
      goalPerformance={goalPerformance}
      activity={activity}
      endArms={endStats.arms}
      endWinner={endWinner}
      demo={demoState(sp)}
    />
  );
}
