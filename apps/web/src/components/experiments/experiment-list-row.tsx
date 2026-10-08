import Link from "next/link";

import { armBg, displayPath } from "@/components/experiments/arm-colors";
import { LiftBadge } from "@/components/experiments/lift-badge";
import { PublishPauseButton } from "@/components/experiments/publish-pause-button";
import { ExperimentStatusBadge } from "@/components/experiments/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { routes } from "@/lib/routes";
import { armShares } from "@/lib/traffic";
import { cn } from "@/lib/utils";
import type { ExperimentStatus } from "@/generated/prisma/enums";
import type { FormState } from "@/lib/form-state";
import type { ExperimentSummary } from "@/server/services/analytics.service";

/**
 * One experiment in the list: a table row on wide screens, a stacked card below the `nav`
 * breakpoint.
 *
 * The whole row opens the experiment through a stretched link on its name, so there is one
 * real anchor per row (one tab stop, a proper "open in new tab") rather than a click handler on
 * a `div`. The action cell sits above that link, because a form nested inside an anchor is
 * invalid HTML and clicking it would follow the link as well as submitting.
 */

/** Shared by the header and every row so the columns cannot drift apart. */
export const EXPERIMENT_ROW_GRID =
  "grid grid-cols-[minmax(200px,2.4fr)_104px_112px_minmax(110px,1fr)_76px_76px_100px_88px_80px] items-center gap-3";

/**
 * Below this many assigned visitors in total, the lift is withheld — the same rule the results
 * page applies. The summary carries no per-arm counts, so the list never names a leader; it only
 * reports the relative change once there is enough traffic for it to be worth reading.
 */
const MIN_TOTAL_FOR_LIFT = 60;

interface ListExperiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  controlUrl: string;
  conversionUrl: string;
  conversionName?: string | null;
  controlWeight: number;
  trafficAllocation: number;
  updatedAt: Date;
  variants: { id: string; weight: number }[];
  website: { domain: string };
}

function rowData(experiment: ListExperiment, summary: ExperimentSummary | undefined) {
  const visitors = summary?.assignedVisitors ?? 0;

  // The highest arm rate, control included — the one number worth surfacing in a list. The
  // per-arm breakdown is the detail page's job.
  const rates = [summary?.controlRate ?? null, summary?.bestVariantRate ?? null].filter(
    (rate): rate is number => rate !== null,
  );
  const rate = rates.length > 0 ? Math.max(...rates) : null;

  const shares = armShares({
    controlWeight: experiment.controlWeight,
    variantWeights: experiment.variants.map((variant) => variant.weight),
    trafficAllocation: experiment.trafficAllocation,
  });
  const arms = [shares.control, ...shares.variants];

  return {
    visitors,
    rate,
    conversions: summary?.conversions ?? 0,
    lift: summary?.lift ?? null,
    liftMeaningful: visitors >= MIN_TOTAL_FOR_LIFT,
    arms,
    excluded: shares.excluded,
    split: arms.join(" / "),
    path: displayPath(experiment.controlUrl),
    goal: experiment.conversionName?.trim() || displayPath(experiment.conversionUrl),
    goalIsPath: !experiment.conversionName?.trim(),
  };
}

function TrafficBar({ arms, excluded }: { arms: number[]; excluded: number }) {
  return (
    <div aria-hidden className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]">
      {arms.map((share, index) => (
        <span key={index} className={armBg(index)} style={{ flex: Math.max(share, 0.0001) }} />
      ))}
      {excluded > 0 ? <span className="bg-divider" style={{ flex: excluded }} /> : null}
    </div>
  );
}

function RowAction({
  experiment,
  statusAction,
}: {
  experiment: ListExperiment;
  statusAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  // A draft has nothing to look at yet, so its one useful action is starting it.
  if (experiment.status === "DRAFT") {
    return (
      <PublishPauseButton
        action={statusAction}
        experimentId={experiment.id}
        status={experiment.status}
      />
    );
  }
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={routes.experiments.detail(experiment.id)}>View →</Link>
    </Button>
  );
}

export function ExperimentListRow({
  experiment,
  summary,
  statusAction,
}: {
  experiment: ListExperiment;
  summary: ExperimentSummary | undefined;
  statusAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const data = rowData(experiment, summary);
  const href = routes.experiments.detail(experiment.id);
  const excludedNote = data.excluded > 0 ? ` · ${data.excluded}% out` : "";

  return (
    <div
      className={cn(
        EXPERIMENT_ROW_GRID,
        "relative border-b border-divider px-[18px] py-3 tabular-nums transition-colors last:border-b-0 hover:bg-subtle",
      )}
    >
      <div className="min-w-0">
        <Link
          href={href}
          className="block truncate text-[13.5px] font-bold outline-none after:absolute after:inset-0 focus-visible:underline"
        >
          {experiment.name}
        </Link>
        <p className="mt-[3px] truncate text-xs text-ink-3">
          <span className="font-mono">{data.path}</span> · {experiment.website.domain}
        </p>
      </div>

      <div>
        <ExperimentStatusBadge status={experiment.status} />
      </div>

      <div className="min-w-0">
        <TrafficBar arms={data.arms} excluded={data.excluded} />
        <p className="mt-1 truncate font-mono text-[11.5px] text-ink-3">
          {data.split}
          {excludedNote}
        </p>
      </div>

      <p
        className={cn(
          "min-w-0 truncate text-[13px] font-semibold",
          data.goalIsPath && "font-mono text-xs",
        )}
        title={data.goal}
      >
        {data.goal}
      </p>

      <p className="text-right text-[13.5px] font-semibold">{formatNumber(data.visitors)}</p>

      <p className="text-right text-[13.5px] font-semibold">{formatPercent(data.rate)}</p>

      <div className="text-right">
        <LiftBadge
          lift={data.lift}
          meaningful={data.liftMeaningful}
          className="justify-end text-[13.5px]"
        />
        <p className="truncate text-[11.5px] text-ink-3">
          {data.liftMeaningful ? "best variant" : "too few visitors"}
        </p>
      </div>

      <p className="text-[12.5px] text-ink-3">{formatDate(experiment.updatedAt)}</p>

      <div className="relative z-10 flex justify-end">
        <RowAction experiment={experiment} statusAction={statusAction} />
      </div>
    </div>
  );
}

/** The same experiment as a stacked card, for screens narrower than the `nav` breakpoint. */
export function ExperimentListCard({
  experiment,
  summary,
  statusAction,
}: {
  experiment: ListExperiment;
  summary: ExperimentSummary | undefined;
  statusAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const data = rowData(experiment, summary);

  return (
    <div className="relative flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 tabular-nums">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <Link
            href={routes.experiments.detail(experiment.id)}
            className="block font-bold outline-none after:absolute after:inset-0 focus-visible:underline"
          >
            {experiment.name}
          </Link>
          <p className="mt-[3px] truncate font-mono text-xs text-ink-3">{data.path}</p>
        </div>
        <ExperimentStatusBadge status={experiment.status} />
      </div>

      <TrafficBar arms={data.arms} excluded={data.excluded} />

      <div className="grid grid-cols-3 gap-2 text-[12.5px]">
        <div className="min-w-0">
          <p className="text-ink-3">Split</p>
          <p className="truncate font-bold">{data.split}</p>
        </div>
        <div className="min-w-0">
          <p className="text-ink-3">Visitors · CR</p>
          <p className="truncate font-bold">
            {formatNumber(data.visitors)} · {formatPercent(data.rate)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-ink-3">Lift</p>
          <LiftBadge lift={data.lift} meaningful={data.liftMeaningful} className="text-[12.5px]" />
        </div>
      </div>

      {experiment.status === "DRAFT" ? (
        <div className="relative z-10 flex">
          <RowAction experiment={experiment} statusAction={statusAction} />
        </div>
      ) : null}
    </div>
  );
}

/** Column labels, using the same grid so they cannot drift from the values beneath. */
export function ExperimentListHeader() {
  return (
    <div
      className={cn(
        EXPERIMENT_ROW_GRID,
        "table-head border-b border-border bg-subtle px-[18px] py-2.5",
      )}
    >
      <span>Experiment</span>
      <span>Status</span>
      <span>Traffic</span>
      <span>Primary goal</span>
      <span className="text-right">Visitors</span>
      <span className="text-right">Conv. rate</span>
      <span className="text-right">Lift</span>
      <span>Updated</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}
