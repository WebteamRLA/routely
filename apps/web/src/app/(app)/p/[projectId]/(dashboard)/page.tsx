import type { Metadata } from "next";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardEmpty } from "@/components/dashboard/dashboard-empty";
import { DashboardSkeleton, DemoDashboardError } from "@/components/dashboard/dashboard-states";
import { DashboardKpis } from "@/components/dashboard/kpi-strip";
import { ConversionsCard } from "@/components/dashboard/conversions-card";
import { ExperimentsOverview } from "@/components/dashboard/experiments-overview";
import { buildDashboard } from "@/components/dashboard/model";
import { VisitorsCard } from "@/components/dashboard/visitors-card";
import { demoState } from "@/lib/demo-state";
import { routes } from "@/lib/routes";
import { draftFromExperiment, validateDraft } from "@/lib/validate-draft";
import { requireUser } from "@/server/auth/session";
import { getProjectDashboard } from "@/server/services/dashboard.service";
import { getExperimentDraftSource } from "@/server/services/experiment.service";
import { listProjectMetrics } from "@/server/services/metric.service";
import { getProject } from "@/server/services/website.service";

export const metadata: Metadata = { title: "Dashboard" };

/** The project dashboard (DESIGN.md §2.2). */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, sp, user] = await Promise.all([params, searchParams, requireUser()]);
  const demo = demoState(sp);

  const [project, data, metrics] = await Promise.all([
    getProject(user.id, projectId),
    getProjectDashboard(user.id, projectId),
    listProjectMetrics(user.id, projectId),
  ]);

  // "N setup steps incomplete" for drafts: the wizard's own validation over each draft.
  const drafts = data.experiments.filter((e) => e.status === "draft");
  const sources = await Promise.all(
    drafts.map((e) => getExperimentDraftSource(user.id, projectId, e.id)),
  );
  const draftIncomplete = Object.fromEntries(
    sources.map((src) => [src.id, Object.keys(validateDraft(draftFromExperiment(src))).length]),
  );

  const empty = demo === "empty" || data.experiments.length === 0;
  const view = buildDashboard(projectId, data, project.threshold, draftIncomplete);
  const title = empty
    ? `Launch your first experiment on ${project.domain || "your site"}.`
    : view.title;
  const sub = empty
    ? "Install the snippet, choose a goal, and Routely handles assignment, tracking and the maths."
    : view.sub;

  return (
    <div className="mx-auto flex w-full max-w-[1680px] animate-rl-in flex-col gap-6">
      <DashboardHeader projectId={projectId} title={title} sub={sub} />
      {demo === "loading" ? (
        <DashboardSkeleton />
      ) : demo === "error" ? (
        <DemoDashboardError />
      ) : empty ? (
        <DashboardEmpty
          projectId={projectId}
          steps={[
            {
              title: "Install the snippet",
              body: "Add one script tag to your site’s head.",
              done: project.installed,
            },
            {
              title: "Create a metric",
              body: "Track purchase, lead or signup via GTM.",
              done: metrics.some((m) => !m.system),
            },
            {
              title: "Launch an experiment",
              body: "Split traffic and watch the results come in.",
              done: false,
            },
          ]}
        />
      ) : (
        <>
          <DashboardKpis tiles={view.strip} />
          <ExperimentsOverview
            rows={view.rows}
            counts={view.counts}
            viewAllHref={routes.project(projectId).experiments({ status: "all" })}
          />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
            <ConversionsCard slices={view.conversions} />
            <VisitorsCard points={view.visitors} />
          </div>
        </>
      )}
    </div>
  );
}
