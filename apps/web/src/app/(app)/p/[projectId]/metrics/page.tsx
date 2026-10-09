import type { Metadata } from "next";

import { GtmPanel } from "@/components/metrics/gtm-panel";
import { MetricsEventsTable } from "@/components/metrics/metrics-events-table";
import { loadProject, orNotFound } from "@/components/settings/data";
import { SettingsShell } from "@/components/settings/settings-shell";
import type { MetricsTab } from "@/lib/routes";
import * as metricService from "@/server/services/metric.service";

export const metadata: Metadata = { title: "Metrics & goals" };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Metrics & goals: the metrics table (`?tab=metrics`) and GTM setup (`?tab=gtm&metric=`), shown
 * as the "Metrics & events" and "Google Tag Manager" tabs of the design's Settings page.
 */
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

  return (
    <SettingsShell projectId={project.id} projectName={project.name} active={tab}>
      {tab === "metrics" ? (
        <MetricsEventsTable
          projectId={project.id}
          metrics={metrics}
          now={new Date().toISOString()}
        />
      ) : (
        <GtmPanel projectId={project.id} metrics={events} selectedId={first(sp.metric) ?? null} />
      )}
    </SettingsShell>
  );
}
