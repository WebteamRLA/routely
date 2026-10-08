import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteExperimentDialog } from "@/components/experiments/delete-experiment-dialog";
import { ExperimentConfiguration } from "@/components/experiments/experiment-configuration";
import { RangePicker } from "@/components/experiments/range-picker";
import { ExperimentResults } from "@/components/experiments/results";
import { SharePanel } from "@/components/experiments/share-panel";
import { ExperimentStatusBadge } from "@/components/experiments/status-badge";
import { StatusControls } from "@/components/experiments/status-controls";
import { env } from "@/env";
import { DEFAULT_RANGE, parseRangeKey, resolveRange } from "@/lib/date-range";
import { formatDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { armShares } from "@/lib/traffic";
import { cn } from "@/lib/utils";
import {
  changeExperimentStatusAction,
  deleteExperimentAction,
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

const TABS = [
  { key: "results", label: "Results" },
  { key: "setup", label: "Setup" },
  { key: "share", label: "Share" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(value: unknown): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

/** One line under the status pill saying where the experiment is in its life. */
function timing(experiment: { status: string; createdAt: Date; publishedAt: Date | null }) {
  const published = experiment.publishedAt ? formatDate(experiment.publishedAt) : null;
  switch (experiment.status) {
    case "DRAFT":
      return `Draft · created ${formatDate(experiment.createdAt)}`;
    case "ACTIVE":
      return published ? `Running · published ${published}` : "Running";
    case "PAUSED":
      return published ? `Paused · published ${published}` : "Paused";
    default:
      return published
        ? `Archived · published ${published}`
        : `Archived · created ${formatDate(experiment.createdAt)}`;
  }
}

export default async function ExperimentPage({
  params,
  searchParams,
}: {
  params: Promise<{ experimentId: string }>;
  searchParams: Promise<{ range?: string; tab?: string }>;
}) {
  const user = await requireUser();
  const [{ experimentId }, { range, tab }] = await Promise.all([params, searchParams]);
  const rangeKey = parseRangeKey(range);

  // The service scopes by actor through the parent website, so an experiment belonging to
  // someone else raises NOT_FOUND — the same response as one that does not exist.
  const experiment = await experimentService.getExperiment(user.id, experimentId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const isDraft = experiment.status === "DRAFT";
  const allowed = experimentService.allowedTransitions(experiment.status);

  // A draft has no results to show, so it opens on its setup instead.
  const activeTab: TabKey = isTabKey(tab) ? tab : isDraft ? "setup" : "results";

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

  function tabHref(key: TabKey) {
    const query = new URLSearchParams();
    if (rangeKey !== DEFAULT_RANGE) query.set("range", rangeKey);
    if (key !== (isDraft ? "setup" : "results")) query.set("tab", key);
    const qs = query.toString();
    return `${routes.experiments.detail(experiment.id)}${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex animate-rl-in flex-col gap-[18px]">
      <header className="flex flex-col gap-2.5">
        <Link
          href={routes.experiments.list}
          className="w-fit text-[13px] font-bold text-ink-3 hover:text-foreground"
        >
          ← Experiments
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3.5">
          <div className="min-w-0 flex-[1_1_420px]">
            <div className="flex flex-wrap items-center gap-2">
              <ExperimentStatusBadge status={experiment.status} />
              <span className="rounded-md border border-input px-[7px] py-0.5 text-xs font-bold text-ink-2">
                Split URL
              </span>
              <span className="text-[12.5px] text-ink-3">
                {timing(experiment)} ·{" "}
                <Link
                  href={routes.websites.detail(experiment.websiteId)}
                  className="font-semibold hover:text-foreground hover:underline"
                >
                  {experiment.website.name}
                </Link>
              </span>
            </div>
            <h1 className="mt-2.5 mb-1 font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em] text-pretty">
              {experiment.name}
            </h1>
            <p className="font-mono text-[12.5px] break-all text-ink-3">{experiment.controlUrl}</p>
          </div>
          {/* Archived is terminal; its banner below already says so. */}
          {allowed.length > 0 ? (
            <StatusControls
              action={changeExperimentStatusAction}
              experimentId={experiment.id}
              currentStatus={experiment.status}
              allowed={allowed}
            />
          ) : null}
        </div>
      </header>

      {experiment.status === "PAUSED" ? (
        <div className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-[13.5px] font-semibold text-warning-text">
          Paused. No new visitors are assigned and nothing new is recorded; results already
          collected are kept. Resume to continue.
        </div>
      ) : null}
      {experiment.status === "ARCHIVED" ? (
        <div className="rounded-lg bg-brand-tint-2 px-4 py-3 text-[13.5px] font-semibold text-[#1F3FB0]">
          Experiment archived. Its results are kept, but it will not collect anything new.
        </div>
      ) : null}
      {isDraft ? (
        <div className="rounded-lg bg-brand-tint-2 px-4 py-3 text-[13.5px] font-semibold text-[#1F3FB0]">
          This experiment is a draft. Nothing is redirected and nothing is recorded until you start
          it.
        </div>
      ) : null}

      <nav
        aria-label="Experiment sections"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((item) => {
          const active = item.key === activeTab;
          return (
            <Link
              key={item.key}
              href={tabHref(item.key)}
              aria-current={active ? "page" : undefined}
              scroll={false}
              className={cn(
                "-mb-px flex h-10 shrink-0 items-center border-b-2 px-3.5 text-[13.5px] font-extrabold transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-ink-3 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {activeTab === "results" ? (
        <ExperimentResults
          control={stats.control}
          controlShare={shares.control}
          variants={variantResults}
          isEmpty={stats.isEmpty}
          controlUrl={experiment.controlUrl}
          primaryMetric={experiment.primaryMetric}
          isDraft={isDraft}
          controls={<RangePicker value={rangeKey} variant="segmented" />}
        />
      ) : null}

      {activeTab === "setup" ? (
        <>
          <ExperimentConfiguration
            hasStarted={!isDraft}
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
          />

          <section className="flex flex-col gap-3 rounded-lg border border-danger-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">
                Delete this experiment
              </h2>
              <p className="mt-1 text-[13px] text-pretty text-ink-3">
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
          </section>
        </>
      ) : null}

      {activeTab === "share" ? (
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
      ) : null}
    </div>
  );
}
