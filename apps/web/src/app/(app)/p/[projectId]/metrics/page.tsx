import type { Metadata } from "next";

import { GtmPanel } from "@/components/metrics/gtm-panel";
import { MetricsEventsTable } from "@/components/metrics/metrics-events-table";
import { PageTitle, UnderlineTabs } from "@/components/rl";
import { loadProject, orNotFound } from "@/components/settings/data";
import { routes, type MetricsTab } from "@/lib/routes";
import * as metricService from "@/server/services/metric.service";

export const metadata: Metadata = { title: "Metrics & goals" };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Metrics & goals: the metrics table (`?tab=metrics`) and GTM setup (`?tab=gtm&metric=`). */
export default async function MetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ projectId }, sp] = await Promise.all([params, searchParams]);
  const tab: MetricsTab = first(sp.tab) === "gtm" ? "gtm" : "metrics";

  const { userId, project } = await loadProject(projectId);
  const metrics = await orNotFound(() => metricService.listProjectMetrics(userId, project.id));
  const events = metrics.filter((m) => !m.system && m.kind === "event");
  const r = routes.project(project.id);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] animate-rl-in flex-col gap-[18px]">
      <PageTitle
        title="Metrics & goals"
        sub={`What Routely measures on ${project.name}, and how to send it.`}
      />
      <UnderlineTabs
        className="border-b border-border"
        ariaLabel="Metrics sections"
        active={tab}
        tabs={[
          { key: "metrics", label: "Metrics & events", count: metrics.length, href: r.metrics() },
          { key: "gtm", label: "Google Tag Manager", href: r.metrics("gtm") },
        ]}
      />
      {tab === "metrics" ? (
        <MetricsEventsTable
          projectId={project.id}
          metrics={metrics}
          now={new Date().toISOString()}
        />
      ) : (
        <GtmPanel projectId={project.id} metrics={events} selectedId={first(sp.metric) ?? null} />
      )}
    </div>
  );
}
