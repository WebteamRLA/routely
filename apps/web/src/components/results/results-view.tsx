"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { DemoState } from "@/lib/demo-state";
import { cn } from "@/lib/utils";
import { verdict as computeVerdict, defaultWinner } from "@/lib/verdict";
import type { ExperimentResults, GoalPerformance, ResultsRange } from "@/lib/view-models";

import { ArmScorecards } from "./arm-scorecards";
import { GoalPerformanceTable } from "./goal-performance";
import { HeadToHead } from "./head-to-head";
import {
  armBadge,
  chartModel,
  goalOptionLabel,
  rangeText,
  resultsStats,
  type ChartMetric,
  type ResultsMeta,
} from "./model";
import { ResultsChart } from "./results-chart";
import { ResultsError, ResultsLoading, ResultsWaiting } from "./results-states";
import { TrafficDistribution } from "./traffic-distribution";
import { VariantComparison } from "./variant-comparison";
import { VerdictHero } from "./verdict-hero";

const METRICS: ChartMetric[] = ["cr", "visitors", "conversions"];

/**
 * The Results tab (prototype L1379–1542), shared by the experiment detail page and the public
 * share page. Range and goal live in the URL (`?range=`, `?goal=`) and are applied by the
 * server; the chart metric (`?metric=`) is client-only and updates the URL without a fetch.
 */
export function ResultsView({
  meta,
  results,
  goalPerformance,
  demo = "normal",
  onDeclare,
}: {
  meta: ResultsMeta;
  results: ExperimentResults;
  /** Present when the experiment tracks more than one goal. */
  goalPerformance: GoalPerformance[] | null;
  demo?: DemoState;
  /** Opens the End experiment modal with the given preselected winner (−1 = none). */
  onDeclare?: (winner: number) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const initialMetric = search.get("metric");
  const [metric, setMetric] = useState<ChartMetric>(
    METRICS.includes(initialMetric as ChartMetric) ? (initialMetric as ChartMetric) : "cr",
  );

  const stats = useMemo(() => resultsStats(meta, results), [meta, results]);
  const chart = useMemo(() => chartModel(results, stats, metric), [results, stats, metric]);
  const vd = computeVerdict(meta.status, meta.winnerPosition, stats, meta.threshold);
  const leaderPos = vd.leader ? vd.leader.i : null;
  const badges = stats.arms.map((a) =>
    armBadge(a.i, a.lift, meta.status, meta.winnerPosition, vd.kind, leaderPos),
  );
  const goal = meta.goals.find((g) => g.key === results.goalKey);
  const goalName = goal?.name ?? "—";

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v == null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function changeMetric(next: ChartMetric) {
    setMetric(next);
    const params = new URLSearchParams(search.toString());
    if (next === "cr") params.delete("metric");
    else params.set("metric", next);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  const onRange = (range: ResultsRange) => navigate({ range: range === "all" ? null : range });
  const onGoal = (key: string) => navigate({ goal: key === meta.goals[0]?.key ? null : key });

  if (demo === "loading") return <ResultsLoading />;
  if (demo === "error") return <ResultsError onRetry={() => router.refresh()} />;
  if (demo === "empty" || stats.v === 0) {
    return (
      <ResultsWaiting
        live={meta.status === "running" && (results.range === "all" || demo === "empty")}
        action={
          results.range !== "all" && demo !== "empty" ? (
            <button
              type="button"
              onClick={() => onRange("all")}
              className="h-9 cursor-pointer rounded-md border border-input bg-card px-3.5 text-[13px] font-bold hover:bg-muted"
            >
              Show all time
            </button>
          ) : undefined
        }
      />
    );
  }

  const goalOptions = meta.goals.map((g, i) => ({
    value: g.key,
    label: goalOptionLabel(g, i === 0),
  }));

  return (
    <div
      className={cn(
        "flex flex-col gap-[18px] transition-opacity",
        pending && "pointer-events-none opacity-60",
      )}
      aria-busy={pending}
    >
      <VerdictHero
        verdict={vd}
        status={meta.status}
        goalOptions={
          goalOptions.length ? goalOptions : [{ value: results.goalKey, label: goalName }]
        }
        goal={results.goalKey}
        onGoal={onGoal}
        range={results.range}
        onRange={onRange}
        rangeText={rangeText(results)}
        onDeclare={onDeclare ? () => onDeclare(defaultWinner(vd)) : undefined}
      />
      <ArmScorecards arms={stats.arms} badges={badges} />
      <ResultsChart
        model={chart}
        metric={metric}
        onMetric={changeMetric}
        armNames={stats.arms.map((a) => a.name)}
        goalName={goalName}
      />
      <VariantComparison
        arms={stats.arms}
        badges={badges}
        totalVisitors={stats.v}
        type={meta.type}
        threshold={meta.threshold}
        goalName={goalName}
        engagement={[...results.arms]
          .sort((a, b) => a.position - b.position)
          .map((a) => ({ pageViews: a.pageViews, avgVisibleMs: a.avgVisibleMs }))}
      />
      {goalPerformance && goalPerformance.length > 1 ? (
        <GoalPerformanceTable
          goals={goalPerformance}
          selected={results.goalKey}
          threshold={meta.threshold}
          onSelect={onGoal}
        />
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4">
        <TrafficDistribution arms={stats.arms} totalVisitors={stats.v} coverage={meta.coverage} />
        <HeadToHead arms={stats.arms} type={meta.type} />
      </div>
    </div>
  );
}
