import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import {
  ExperimentListCard,
  ExperimentListHeader,
  ExperimentListRow,
} from "@/components/experiments/experiment-list-row";
import { ListFilters, type StatusTab } from "@/components/experiments/list-filters";
import { RangePicker } from "@/components/experiments/range-picker";
import { Button } from "@/components/ui/button";
import { DEFAULT_RANGE, parseRangeKey, resolveRange } from "@/lib/date-range";
import { routes } from "@/lib/routes";
import { changeExperimentStatusAction } from "@/server/actions/experiment.actions";
import { requireUser } from "@/server/auth/session";
import * as analyticsService from "@/server/services/analytics.service";
import * as experimentService from "@/server/services/experiment.service";
import type { ExperimentStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Experiments" };

const STATUS_TABS: { key: string; label: string; status?: ExperimentStatus }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Running", status: "ACTIVE" },
  { key: "draft", label: "Draft", status: "DRAFT" },
  { key: "paused", label: "Paused", status: "PAUSED" },
  { key: "archived", label: "Archived", status: "ARCHIVED" },
];

/**
 * Every experiment the user owns, across all their websites.
 *
 * Filtering and search happen in the database, and the per-row metrics come from one batched
 * aggregation rather than a query per row — so the page costs the same whether a customer has
 * three experiments or three hundred.
 */
export default async function ExperimentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; range?: string }>;
}) {
  const user = await requireUser();
  const { status = "all", q = "", range } = await searchParams;

  const rangeKey = parseRangeKey(range);
  const selected = STATUS_TABS.find((tab) => tab.key === status) ?? STATUS_TABS[0]!;

  const [experiments, counts] = await Promise.all([
    experimentService.listAllExperiments(user.id, {
      ...(selected.status ? { status: selected.status } : {}),
      ...(q.trim() ? { search: q.trim() } : {}),
    }),
    experimentService.countByStatus(user.id),
  ]);

  const summaries = await analyticsService.getExperimentSummaries(
    user.id,
    experiments.map((experiment) => experiment.id),
    resolveRange(rangeKey),
  );

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  const tabs: StatusTab[] = STATUS_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    count: tab.status ? counts[tab.status] : total,
  }));

  const isFiltered = status !== "all" || q.trim().length > 0;

  const clearHref =
    rangeKey === DEFAULT_RANGE
      ? routes.experiments.list
      : `${routes.experiments.list}?range=${encodeURIComponent(rangeKey)}`;

  const rowProps = (experiment: (typeof experiments)[number]) => ({
    experiment,
    summary: summaries.get(experiment.id),
    statusAction: changeExperimentStatusAction,
  });

  return (
    <div className="flex animate-rl-in flex-col gap-[18px]">
      <PageHeader
        title="Experiments"
        description="Every redirect test across your websites."
        actions={
          <Button size="lg" asChild>
            <Link href={routes.experiments.new()}>+ New experiment</Link>
          </Button>
        }
      />

      {total === 0 ? (
        <EmptyState
          title="No experiments yet"
          description="Create an experiment to send half your visitors to an alternative page and compare the two."
          action={
            <Button asChild>
              <Link href={routes.experiments.new()}>+ New experiment</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ListFilters tabs={tabs} status={status} search={q}>
            <RangePicker value={rangeKey} />
          </ListFilters>

          {experiments.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-6 py-10 text-center">
              <h2 className="font-heading text-[17px] font-semibold">
                No experiments match these filters
              </h2>
              <p className="mt-1.5 mb-3.5 text-ink-3">
                {isFiltered ? "Try a different search term or status." : "No experiments to show."}
              </p>
              {isFiltered ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={clearHref}>Clear filters</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-lg border border-border bg-card nav:block">
                <div className="min-w-[1080px]">
                  <ExperimentListHeader />
                  {experiments.map((experiment) => (
                    <ExperimentListRow key={experiment.id} {...rowProps(experiment)} />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2.5 nav:hidden">
                {experiments.map((experiment) => (
                  <ExperimentListCard key={experiment.id} {...rowProps(experiment)} />
                ))}
              </div>
            </>
          )}

          <p className="text-xs text-pretty text-ink-3">
            Conversion rate is the best-performing arm&rsquo;s, over the selected range. Lift is the
            best variant&rsquo;s conversion rate relative to control&rsquo;s, shown once an
            experiment has at least 60 assigned visitors — arithmetic, not a significance test.
            Traffic is each arm&rsquo;s share of the control page&rsquo;s visitors. Open an
            experiment for the per-arm breakdown.
          </p>
        </>
      )}
    </div>
  );
}
