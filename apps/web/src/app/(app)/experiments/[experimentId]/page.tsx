import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Target } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { DeleteExperimentDialog } from "@/components/experiments/delete-experiment-dialog";
import { ExperimentForm } from "@/components/experiments/experiment-form";
import { RangePicker } from "@/components/experiments/range-picker";
import { ExperimentResults } from "@/components/experiments/results";
import { SharePanel } from "@/components/experiments/share-panel";
import { ExperimentStatusBadge } from "@/components/experiments/status-badge";
import { StatusControls } from "@/components/experiments/status-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { env } from "@/env";
import { parseRangeKey, resolveRange } from "@/lib/date-range";
import { formatDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { armShares } from "@/lib/traffic";
import {
  changeExperimentStatusAction,
  deleteExperimentAction,
  updateExperimentAction,
} from "@/server/actions/experiment.actions";
import {
  disableSharingAction,
  enableSharingAction,
  rotateShareTokenAction,
} from "@/server/actions/share.actions";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as analyticsService from "@/server/services/analytics.service";
import * as experimentService from "@/server/services/experiment.service";

export const metadata: Metadata = { title: "Experiment" };

/** One arm of the test, shown as the page it points at. */
function Arm({
  label,
  url,
  description,
  emphasis = false,
}: {
  label: string;
  url: string;
  description: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "min-w-0 rounded-xl bg-primary/[0.03] p-4 ring-1 ring-primary/30"
          : "min-w-0 rounded-xl p-4 ring-1 ring-border/70"
      }
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-sm" title={url}>
        {url}
      </p>
      <p className="mt-2 text-xs text-pretty text-muted-foreground">{description}</p>
    </div>
  );
}

export default async function ExperimentPage({
  params,
  searchParams,
}: {
  params: Promise<{ experimentId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const [{ experimentId }, { range }] = await Promise.all([params, searchParams]);
  const rangeKey = parseRangeKey(range);

  // The service scopes by actor through the parent website, so an experiment belonging to
  // someone else raises NOT_FOUND — the same response as one that does not exist.
  const experiment = await experimentService.getExperiment(user.id, experimentId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const isDraft = experiment.status === "DRAFT";
  const allowed = experimentService.allowedTransitions(experiment.status);

  // Authorized twice over: the experiment was already resolved through the ownership chain
  // above, and the analytics service re-checks it rather than trusting a caller to have done
  // so. Reads are the easiest place for an ownership check to be quietly skipped.
  const stats = await analyticsService.getExperimentStats(
    user.id,
    experiment.id,
    resolveRange(rangeKey),
  );

  const shares = armShares({
    controlWeight: experiment.controlWeight,
    variantWeights: experiment.variants.map((variant) => variant.weight),
    trafficAllocation: experiment.trafficAllocation,
  });

  // `stats.variants` is built from `experiment.variants.map(v => v.id)`, in that same order —
  // zipping by index rather than searching keeps this a single pass, not one lookup per row.
  const variantResults = experiment.variants.map((variant, index) => ({
    variantId: variant.id,
    url: variant.url,
    label: `Variant ${index + 1}`,
    share: shares.variants[index] ?? 0,
    stats: stats.variants[index]!.stats,
  }));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={routes.websites.detail(experiment.websiteId)}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {experiment.website.name}
          </Link>
        }
        title={experiment.name}
        description={experiment.description ?? undefined}
        actions={<ExperimentStatusBadge status={experiment.status} />}
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Results</h2>
          <RangePicker value={rangeKey} />
        </div>
        <ExperimentResults
          control={stats.control}
          controlShare={shares.control}
          variants={variantResults}
          isEmpty={stats.isEmpty}
          controlUrl={experiment.controlUrl}
          primaryMetric={experiment.primaryMetric}
          isDraft={isDraft}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>What this test does</CardTitle>
          <CardDescription>
            Visitors arriving at the control are divided between the versions below, in the shares
            you set. Reaching the conversion URL counts as a conversion for whichever version they
            saw.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Arm
              label={`Control · ${shares.control}%`}
              url={experiment.controlUrl}
              description="The original page. These visitors stay where they landed."
            />
            {experiment.variants.map((variant, index) => (
              <Arm
                key={variant.id}
                label={`Variant ${index + 1} · ${shares.variants[index] ?? 0}%`}
                url={variant.url}
                description="These visitors are redirected here instead."
                emphasis
              />
            ))}
          </div>

          <div className="flex gap-3 border-t border-border/70 pt-4">
            <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Conversion goal</p>
              <p className="truncate font-mono text-sm" title={experiment.conversionUrl}>
                {experiment.conversionUrl}
              </p>
            </div>
          </div>

          <dl className="grid gap-4 text-xs text-muted-foreground sm:grid-cols-4">
            <div>
              <dt className="font-medium">Created</dt>
              <dd className="mt-0.5 text-foreground">{formatDate(experiment.createdAt)}</dd>
            </div>
            <div>
              <dt className="font-medium">Published</dt>
              <dd className="mt-0.5 text-foreground">
                {experiment.publishedAt ? formatDate(experiment.publishedAt) : "Never"}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Traffic split</dt>
              <dd className="mt-0.5 text-foreground">
                {[shares.control, ...shares.variants].map((share) => `${share}%`).join(" / ")}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Included in test</dt>
              <dd className="mt-0.5 text-foreground">
                {experiment.trafficAllocation}%{" "}
                {experiment.trafficAllocation < 100 ? "of visitors" : "(everyone)"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            {isDraft
              ? "This experiment is a draft. Nothing is redirected and nothing is recorded until you start it."
              : "Visitors are assigned as they arrive. Pausing stops new assignments; results already collected are kept."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatusControls
            action={changeExperimentStatusAction}
            experimentId={experiment.id}
            currentStatus={experiment.status}
            allowed={allowed}
          />
        </CardContent>
      </Card>

      <SharePanel
        experimentId={experiment.id}
        shareUrl={
          experiment.shareToken
            ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}${routes.share(experiment.shareToken)}`
            : null
        }
        enable={enableSharingAction}
        rotate={rotateShareTokenAction}
        disable={disableSharingAction}
      />

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Settings</h2>
        <Card>
          <CardHeader>
            <CardTitle>Edit experiment</CardTitle>
            <CardDescription>
              {isDraft
                ? "Change anything you like while this is still a draft."
                : "The name and description can be edited at any time. The URLs are fixed once the experiment has started."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExperimentForm
              action={updateExperimentAction}
              experimentId={experiment.id}
              urlsLocked={!isDraft}
              defaults={{
                name: experiment.name,
                description: experiment.description ?? undefined,
                controlUrl: experiment.controlUrl,
                controlMatchType: experiment.controlMatchType,
                controlWeight: experiment.controlWeight,
                variants: experiment.variants.map((variant) => ({
                  id: variant.id,
                  url: variant.url,
                  weight: variant.weight,
                })),
                conversionUrl: experiment.conversionUrl,
                conversionMatchType: experiment.conversionMatchType,
                primaryMetric: experiment.primaryMetric,
                trafficAllocation: experiment.trafficAllocation,
              }}
              submitLabel="Save changes"
              pendingLabel="Saving…"
            />

            <Separator className="my-6" />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Delete this experiment</p>
                <p className="text-sm text-pretty text-muted-foreground">
                  {stats.isEmpty
                    ? "Nothing has been recorded yet, so no results would be lost."
                    : "Removes the experiment and every visitor, event and conversion recorded under it. Archive it instead to stop it running but keep the results."}
                </p>
              </div>
              <DeleteExperimentDialog
                action={deleteExperimentAction}
                experimentId={experiment.id}
                websiteId={experiment.websiteId}
                experimentName={experiment.name}
                hasResults={!stats.isEmpty}
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
