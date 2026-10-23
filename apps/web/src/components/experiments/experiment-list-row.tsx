import Link from "next/link";

import { PublishPauseButton } from "@/components/experiments/publish-pause-button";
import { Button } from "@/components/ui/button";
import { formatNumber, formatPercent } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { ExperimentStatus } from "@/generated/prisma/enums";
import type { FormState } from "@/lib/form-state";
import type { ExperimentSummary } from "@/server/services/analytics.service";

/**
 * One experiment in the list, as a row of the state someone actually decides on.
 *
 * The "Needs action" column is the point of the layout: an experiment is far more often waiting
 * on its owner than genuinely mid-flight, and the reason differs — never launched, launched but
 * receiving nothing, paused. Naming that reason beside each row turns a list of statuses into a
 * list of next steps.
 */

/** Shared by the header and every row so the columns cannot drift apart. */
export const EXPERIMENT_ROW_GRID =
  "grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,2.1fr)_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)_9rem] sm:items-center sm:gap-4";

const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-500",
  "bg-pink-600",
  "bg-cyan-600",
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 2147483647;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

/** The coloured stripe down the left edge, matching the status dot. */
const STATUS_ACCENT: Record<ExperimentStatus, string> = {
  ACTIVE: "bg-emerald-500",
  DRAFT: "bg-amber-500",
  PAUSED: "bg-slate-400",
  COMPLETED: "bg-slate-300",
};

const STATUS_DOT: Record<ExperimentStatus, string> = {
  ACTIVE: "bg-emerald-500",
  DRAFT: "bg-amber-500",
  PAUSED: "bg-slate-400",
  COMPLETED: "bg-slate-300",
};

const STATUS_LABEL: Record<ExperimentStatus, string> = {
  ACTIVE: "Running",
  DRAFT: "Draft",
  PAUSED: "Paused",
  COMPLETED: "Completed",
};

/**
 * What this experiment is waiting on, as a headline plus the reason underneath.
 *
 * Deliberately not a restatement of the status: "Running" is not an action, whereas "no traffic
 * yet — check the snippet is installed" is. Only the cases that genuinely need someone are
 * given an urgent tone.
 */
function needsAction(
  status: ExperimentStatus,
  visitors: number,
): { headline: string; detail: string; urgent: boolean } {
  if (status === "DRAFT") {
    return { headline: "Not launched", detail: "built but never started", urgent: true };
  }
  if (status === "COMPLETED") {
    return { headline: "Completed", detail: "kept for its results", urgent: false };
  }
  if (status === "PAUSED") {
    return { headline: "Paused", detail: "no new visitors are assigned", urgent: true };
  }
  if (visitors === 0) {
    return { headline: "No traffic", detail: "check targeting and install", urgent: true };
  }
  return { headline: "Collecting", detail: "results update as visitors arrive", urgent: false };
}

export function ExperimentListRow({
  experiment,
  summary,
  statusAction,
}: {
  experiment: {
    id: string;
    name: string;
    status: ExperimentStatus;
    trafficAllocation: number;
    variants: { id: string }[];
    website: { domain: string };
  };
  summary: ExperimentSummary | undefined;
  statusAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const visitors = summary?.assignedVisitors ?? 0;
  const action = needsAction(experiment.status, visitors);
  const isDraft = experiment.status === "DRAFT";

  // The best-performing variant's rate is the one number worth surfacing in a list; the
  // per-arm breakdown is the detail page's job.
  const rate = summary?.bestVariantRate ?? summary?.controlRate ?? null;

  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", STATUS_ACCENT[experiment.status])}
      />

      <div
        className={cn(EXPERIMENT_ROW_GRID, "py-3.5 pr-4 pl-5 transition-colors hover:bg-muted/40")}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white",
              avatarColor(experiment.id),
            )}
          >
            {experiment.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <Link
              href={routes.experiments.detail(experiment.id)}
              className="block truncate text-sm font-medium hover:underline"
            >
              {experiment.name}
            </Link>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[experiment.status])}
              />
              <span className="truncate">
                {STATUS_LABEL[experiment.status]} · {experiment.website.domain}
              </span>
            </span>
          </span>
        </div>

        <div className="col-start-1 min-w-0 sm:col-start-auto">
          <p className={cn("text-sm font-medium", action.urgent && "text-foreground")}>
            {action.headline}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{action.detail}</p>
        </div>

        <div className="col-start-1 min-w-0 sm:col-start-auto">
          <p className="text-sm font-medium tabular-nums">{formatNumber(visitors)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {experiment.variants.length} variant{experiment.variants.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="col-start-1 min-w-0 sm:col-start-auto">
          <p className="text-sm font-medium tabular-nums">{experiment.trafficAllocation}%</p>
          <div aria-hidden className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${experiment.trafficAllocation}%` }}
            />
          </div>
        </div>

        <div className="col-start-1 min-w-0 sm:col-start-auto">
          <p className="text-sm font-medium tabular-nums">{formatPercent(rate)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {rate === null
              ? "no result yet"
              : `${formatNumber(summary?.conversions ?? 0)} conversion${
                  (summary?.conversions ?? 0) === 1 ? "" : "s"
                }`}
          </p>
        </div>

        {/* A draft has nothing to look at yet, so its one useful action is starting it. */}
        <div className="col-start-2 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
          {isDraft ? (
            <PublishPauseButton
              action={statusAction}
              experimentId={experiment.id}
              status={experiment.status}
            />
          ) : (
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href={routes.experiments.detail(experiment.id)}>View results</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Column labels, using the same grid so they cannot drift from the values beneath. */
export function ExperimentListHeader() {
  return (
    <div
      className={cn(
        EXPERIMENT_ROW_GRID,
        "hidden border-b border-border/70 py-2 pr-4 pl-5 text-xs font-medium text-muted-foreground sm:grid",
      )}
    >
      <span>Experiment</span>
      <span>Needs action</span>
      <span>Visitors</span>
      <span>Traffic share</span>
      <span>Conversion rate</span>
      <span className="text-right">Actions</span>
    </div>
  );
}
