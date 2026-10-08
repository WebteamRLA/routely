import Link from "next/link";

import { ExperimentStatusBadge } from "@/components/experiments/status-badge";
import { PublishPauseButton } from "@/components/experiments/publish-pause-button";
import { formatDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { changeExperimentStatusAction } from "@/server/actions/experiment.actions";
import type { Experiment } from "@/generated/prisma/client";

/**
 * One experiment in a website's list.
 *
 * The publish/pause control sits outside the row's link rather than inside it — a button
 * nested in an anchor is invalid HTML, and clicking it would follow the link as well as
 * submitting. Splitting them keeps one tab stop for "open" and one for "publish/pause".
 */
export function ExperimentRow({ experiment }: { experiment: Experiment }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-[18px] py-3 transition-colors focus-within:border-primary hover:bg-subtle">
      <Link
        href={routes.experiments.detail(experiment.id)}
        className="min-w-0 flex-1 rounded-md outline-none"
      >
        <span className="block truncate text-[13.5px] font-bold">{experiment.name}</span>
        <span className="mt-[3px] block truncate font-mono text-xs text-ink-3">
          {experiment.controlUrl}
        </span>
      </Link>

      <span className="hidden text-[12.5px] whitespace-nowrap text-ink-3 md:block">
        {experiment.publishedAt
          ? `Published ${formatDate(experiment.publishedAt)}`
          : `Created ${formatDate(experiment.createdAt)}`}
      </span>

      <ExperimentStatusBadge status={experiment.status} />

      <PublishPauseButton
        action={changeExperimentStatusAction}
        experimentId={experiment.id}
        status={experiment.status}
      />
    </div>
  );
}
