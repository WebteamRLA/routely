import type { Metadata } from "next";

import { ConversionsCard } from "@/components/dashboard/conversions-card";
import { DashboardEmpty } from "@/components/dashboard/dashboard-empty";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardSkeleton, DemoDashboardError } from "@/components/dashboard/dashboard-states";
import { ExperimentsOverview } from "@/components/dashboard/experiments-overview";
import { DashboardInstallProvider } from "@/components/dashboard/install-context";
import { buildDashboard } from "@/components/dashboard/model";
import { ActivityCard, IntegrationsCard } from "@/components/dashboard/rail-cards";
import { VisitorsCard } from "@/components/dashboard/visitors-card";
import { installInfoFor } from "@/components/tracking/data";
import { demoState } from "@/lib/demo-state";
import { routes } from "@/lib/routes";
import { draftFromExperiment, incompleteSteps, validateDraft } from "@/lib/validate-draft";
import { requireUser } from "@/server/auth/session";
import { getProjectDashboard } from "@/server/services/dashboard.service";
import { getExperimentDraftSource } from "@/server/services/experiment.service";
import { listProjectMetrics } from "@/server/services/metric.service";
import { getProject } from "@/server/services/website.service";

export const metadata: Metadata = { title: "Dashboard" };

/** The project dashboard — "Overview" (design v2 `isDash`). */
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

  // "N steps left" for drafts: the wizard's own validation over each draft.
  const drafts = data.experiments.filter((e) => e.status === "draft");
  const sources = await Promise.all(
    drafts.map((e) => getExperimentDraftSource(user.id, projectId, e.id)),
  );
  const draftIncomplete = Object.fromEntries(
    sources.map((src) => [src.id, incompleteSteps(validateDraft(draftFromExperiment(src))).length]),
  );

  const view = buildDashboard(data, {
    projectId,
    domain: project.domain,
    installed: project.installed,
    threshold: project.threshold,
    draftIncomplete,
    // Activity rows record the actor as the experiment service does: name, else email.
    actorName: user.name?.trim() || user.email,
  });
  const p = routes.project(projectId);
  const empty = demo === "empty" || data.experiments.length === 0;

  return (
    <DashboardInstallProvider install={installInfoFor(project)} projectName={project.name}>
      <div className="mx-auto flex w-full max-w-[1680px] animate-rl-in flex-col gap-6">
        <DashboardHeader
          projectId={projectId}
          projectName={project.name}
          tracking={view.tracking}
          sub={
            empty
              ? "Install the snippet, choose a goal, and Routely handles assignment, tracking and the maths."
              : view.sub
          }
          exportRows={view.exportRows}
        />
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
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 min-[1360px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-5">
              <ExperimentsOverview
                rows={view.rows}
                counts={view.counts}
                viewAllHref={p.experiments({ status: "all" })}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-5">
                <ConversionsCard data={view.conversions} />
                <VisitorsCard data={view.visitors} />
              </div>
            </div>
            <aside aria-label="Activity and integrations" className="flex min-w-0 flex-col gap-5">
              <ActivityCard
                feed={view.feed}
                allHref={p.experiments({ status: "all" })}
                teamHref={p.settings("team")}
              />
              <IntegrationsCard items={view.integrations} allHref={p.integrations()} />
            </aside>
          </div>
        )}
      </div>
    </DashboardInstallProvider>
  );
}
