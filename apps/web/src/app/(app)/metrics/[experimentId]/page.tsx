import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/common/page-header";
import { DeleteGoalButton } from "@/components/metrics/delete-goal-button";
import { GoalSetupForm } from "@/components/metrics/goal-setup-form";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import {
  deleteMetricsAction,
  updateMetricAction,
  validateGoalAction,
} from "@/server/actions/metrics.actions";
import { requireUser } from "@/server/auth/session";
import * as metricsService from "@/server/services/metrics.service";

export const metadata: Metadata = { title: "Conversion goal" };

/**
 * Conversion goal setup for one experiment.
 *
 * A page rather than a dialog: the URL rules can refuse a change for reasons that need
 * explaining — the goal must be on the website's domain, must differ from the control and
 * variant pages, and is frozen once visitors have been bucketed — and a modal is a poor place
 * to read a paragraph and then decide.
 */
export default async function MetricPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const user = await requireUser();
  const { experimentId } = await params;

  const metric = await metricsService.getMetric(user.id, experimentId);

  // A goal the actor does not own is indistinguishable from one that never existed, so an id
  // cannot be probed for existence.
  if (!metric) notFound();

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]">
      <PageHeader
        eyebrow={
          <Link href={routes.metrics.list} className="text-primary hover:text-brand-hover">
            ← Metrics &amp; goals
          </Link>
        }
        title="Conversion goal setup"
        description={`Measured by ${metric.experimentName} on ${metric.websiteName}.`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={routes.experiments.detail(metric.experimentId)}>View experiment</Link>
            </Button>
            <DeleteGoalButton metric={metric} action={deleteMetricsAction} />
          </div>
        }
      />

      <div className="w-full max-w-[46rem]">
        <GoalSetupForm
          metric={metric}
          saveAction={updateMetricAction}
          validateAction={validateGoalAction}
        />
      </div>
    </div>
  );
}
