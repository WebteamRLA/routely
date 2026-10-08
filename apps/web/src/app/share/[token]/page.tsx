import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExperimentResults } from "@/components/experiments/results";
import { ExperimentStatusBadge } from "@/components/experiments/status-badge";
import { Brand } from "@/components/layout/brand";
import { formatDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { armShares } from "@/lib/traffic";
import { cn } from "@/lib/utils";
import * as analyticsService from "@/server/services/analytics.service";
import * as experimentService from "@/server/services/experiment.service";

/**
 * Public, read-only results.
 *
 * Reached by an unguessable token and nothing else — no session, and no way to navigate from
 * here to anything the viewer was not given. What it shows is deliberately narrow: this
 * experiment's numbers and its configured URLs. It does not name the account, list other
 * experiments, or link into the dashboard.
 *
 * Outside the `(app)` route group on purpose, so it inherits neither the authenticated layout
 * nor the proxy's protected prefixes.
 */

/** Never indexed: a share link is private-by-obscurity, and a crawler would defeat that. */
export const metadata: Metadata = {
  title: "Experiment results",
  robots: { index: false, follow: false, nocache: true },
};

/** The design's arm colours by position: control grey, then blue, coral, teal, ochre. */
const ARM_COLORS = ["bg-arm-control", "bg-arm-a", "bg-arm-b", "bg-arm-c", "bg-arm-d"];

function armColor(index: number): string {
  // Control is index 0; variants cycle through the four arm colours, never back to grey.
  return index === 0 ? ARM_COLORS[0]! : ARM_COLORS[1 + ((index - 1) % 4)]!;
}

export default async function SharedResultsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const experiment = await experimentService.findSharedExperiment(token);

  // An unknown token and a revoked one are the same 404. Distinguishing them would tell a
  // stranger that a link once existed, which is not theirs to learn.
  if (!experiment) {
    notFound();
  }

  // No actor: the token authorised this read, so the stats are fetched directly rather than
  // through the owner-scoped path.
  const variantIds = experiment.variants.map((variant) => variant.id);
  const stats = await analyticsService.getSharedExperimentStats(experiment.id, variantIds);

  const shares = armShares({
    controlWeight: experiment.controlWeight,
    variantWeights: experiment.variants.map((variant) => variant.weight),
    trafficAllocation: experiment.trafficAllocation,
  });

  // `stats.variants` is built from `variantIds`, in that same order — zipping by index rather
  // than searching keeps this a single pass, not one lookup per row.
  const variantResults = experiment.variants.map((variant, index) => ({
    variantId: variant.id,
    url: variant.url,
    label: `Variant ${index + 1}`,
    share: shares.variants[index] ?? 0,
    stats: stats.variants[index]!.stats,
  }));

  const arms = [
    { label: "Control", url: experiment.controlUrl, share: shares.control },
    ...experiment.variants.map((variant, index) => ({
      label: `Variant ${index + 1}`,
      url: variant.url,
      share: shares.variants[index] ?? 0,
    })),
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6">
          <Brand href={routes.home} />
          <span className="rounded-md border border-input px-[7px] py-0.5 text-xs font-bold text-ink-2">
            Shared results
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1320px] animate-rl-in flex-col gap-[18px] px-4 py-7 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ExperimentStatusBadge status={experiment.status} />
            <span className="text-[12.5px] text-ink-3">
              {experiment.publishedAt
                ? `Running since ${formatDate(experiment.publishedAt)}`
                : "Not yet published"}
              {" · All time"}
            </span>
          </div>
          <h1 className="mt-2.5 mb-1 font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em] text-pretty">
            {experiment.name}
          </h1>
          <p className="font-mono text-[12.5px] break-all text-ink-3">{experiment.controlUrl}</p>
          {experiment.description ? (
            <p className="mt-2 max-w-[680px] text-sm text-pretty text-ink-2">
              {experiment.description}
            </p>
          ) : null}
        </div>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">
              What is being tested
            </h2>
            <p className="mt-0.5 text-[12.5px] text-pretty text-ink-3">
              Visitors arriving at the control are divided between the versions below, in the shares
              shown. Reaching the conversion URL counts as a conversion for whichever version they
              saw.
            </p>
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            <ul className="flex flex-col">
              {arms.map((arm, index) => (
                <li
                  key={arm.label}
                  className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-divider py-2.5 last:border-b-0"
                >
                  <span
                    aria-hidden
                    className={cn("size-2.5 flex-none rounded-[3px]", armColor(index))}
                  />
                  <span className="min-w-[78px] text-[13.5px] font-extrabold">{arm.label}</span>
                  <span className="min-w-[42px] text-[13.5px] font-bold tabular-nums">
                    {arm.share}%
                  </span>
                  <span
                    className="min-w-0 flex-1 basis-[200px] truncate font-mono text-xs text-ink-3"
                    title={arm.url}
                  >
                    {arm.url}
                  </span>
                </li>
              ))}
              {shares.excluded > 0 ? (
                <li className="flex flex-wrap items-baseline gap-x-2.5 border-b border-divider py-2.5 text-ink-3">
                  <span aria-hidden className="size-2.5 flex-none rounded-[3px] bg-divider" />
                  <span className="min-w-[78px] text-[13.5px] font-extrabold">Not in test</span>
                  <span className="min-w-[42px] text-[13.5px] font-bold tabular-nums">
                    {shares.excluded}%
                  </span>
                </li>
              ) : null}
            </ul>

            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-md bg-subtle px-3 py-2.5">
              <span className="text-xs font-extrabold tracking-[0.08em] text-ink-3 uppercase">
                Conversion goal
              </span>
              <span
                className="min-w-0 flex-1 basis-[200px] truncate font-mono text-xs"
                title={experiment.conversionUrl}
              >
                {experiment.conversionUrl}
              </span>
            </div>
          </div>
        </section>

        <ExperimentResults
          control={stats.control}
          controlShare={shares.control}
          variants={variantResults}
          isEmpty={stats.isEmpty}
          controlUrl={experiment.controlUrl}
          primaryMetric={experiment.primaryMetric}
          isDraft={experiment.status === "DRAFT"}
        />

        <p className="border-t border-border pt-5 text-[12.5px] text-ink-3">
          Shared from Routely. Whoever created this link can revoke it at any time.
        </p>
      </main>
    </div>
  );
}
