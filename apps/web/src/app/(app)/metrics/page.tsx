import type { Metadata } from "next";
import Link from "next/link";
import { Target } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { MetricsFilters, type MetricTab } from "@/components/metrics/metrics-filters";
import { MetricsTable } from "@/components/metrics/metrics-table";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";
import { deleteMetricsAction } from "@/server/actions/metrics.actions";
import * as metricsService from "@/server/services/metrics.service";

export const metadata: Metadata = { title: "Metrics & goals" };

/**
 * Every conversion goal across the account, listed as measurable actions.
 *
 * **A metric here is an experiment's conversion goal.** Routely has no separate `Metric`
 * table, and deliberately so: the goal URL is what a conversion means, and a second store for
 * the same fact is a second place for it to be wrong. That shapes the page — it lists and
 * filters, and every action leads back to the experiment that owns the goal, because that is
 * where a goal is created and changed.
 *
 * Two controls from the reference design are absent for the same reason:
 *
 *  - **"Add metric"** would need somewhere to put a goal that is not an experiment. The button
 *    here creates an experiment, which is how a goal comes into existence.
 *  - **"Delete duplicates"** would delete an experiment and its results, and duplicate goals
 *    are normal anyway — every test on the way to a checkout page shares that page as a goal.
 *    The count is surfaced as a note instead.
 */
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; type?: string; sort?: string }>;
}) {
  const user = await requireUser();
  const { tab = "summary", q = "", type = "all", sort = "recent" } = await searchParams;

  const selectedTab = tab === "live" ? "live" : "summary";
  const selectedSort = sort === "conversions" || sort === "name" ? sort : "recent";

  const [metrics, everything] = await Promise.all([
    metricsService.listMetrics(user.id, {
      tab: selectedTab,
      search: q,
      type,
      sort: selectedSort,
    }),
    // Unfiltered, so the tab counts describe the account rather than the current filter.
    metricsService.listMetrics(user.id),
  ]);

  const duplicates = metricsService.countDuplicateGoals(everything);

  const tabs: MetricTab[] = [
    { key: "summary", label: "Summary", count: everything.length },
    {
      key: "live",
      label: "Live",
      count: everything.filter((metric) => metric.status === "ACTIVE").length,
    },
  ];

  const isFiltered = q.trim().length > 0 || type !== "all" || selectedTab === "live";

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]">
      <PageHeader
        title="Metrics & goals"
        description="Every conversion goal across your experiments — the pages that count as success. A goal is defined on the experiment that uses it; page views are tracked automatically."
        actions={
          <Button asChild>
            <Link href={routes.experiments.new()}>+ New experiment</Link>
          </Button>
        }
      />

      {everything.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No metrics yet"
          description="Every experiment sets a conversion goal — the page a visitor has to reach for the test to count a win. Create an experiment and its goal appears here."
          action={
            <Button asChild>
              <Link href={routes.experiments.new()}>+ New experiment</Link>
            </Button>
          }
        />
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-5 py-[18px]">
            <div className="min-w-0">
              <h2 className="m-0 font-heading text-[15.5px] font-bold tracking-[-0.01em]">
                Conversion goals
              </h2>
              <p className="mt-1 max-w-[560px] text-[13px] text-ink-3">
                A visitor converts when they land on the goal URL after being assigned an arm.
                Conversions count once per assignment, so a refresh never inflates them.
              </p>
            </div>
          </div>

          <MetricsFilters
            tabs={tabs}
            tab={selectedTab}
            search={q}
            type={type}
            sort={selectedSort}
            types={metricsService.METRIC_TYPES}
            total={metrics.length}
          />

          {metrics.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13.5px] text-ink-3">
              No metrics match these filters.
            </p>
          ) : (
            <MetricsTable metrics={metrics} deleteAction={deleteMetricsAction} />
          )}

          {duplicates > 0 && !isFiltered ? (
            <p className="border-t border-divider bg-subtle px-5 py-3 text-[12.5px] text-ink-3">
              {duplicates} goal {duplicates === 1 ? "URL is" : "URLs are"} used by more than one
              experiment. That is usually deliberate — several tests on the way to the same page
              share it — so nothing is removed automatically.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
