import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  ProjectDashboardView,
  type ProjectDashboardData,
} from "@/components/project-dashboard/project-dashboard-view";
import { LiveRefresh } from "@/components/rt/live-refresh";
import { PD_VIEWS, type PdView, type ProjectHeader } from "@/lib/project-dashboard";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as projectDashboard from "@/server/services/project-dashboard.service";
import { getProjectSheetsCard } from "@/server/services/sheets-sync.service";

export const metadata: Metadata = { title: "Project dashboard" };

/**
 * A project's dashboard: tracking pixel, Google Sheets, its experiments and two charts.
 *
 * The header (project, pixel, permissions) is loaded first — it is also the access check, so a
 * project in someone else's workspace is a real 404 before anything streams. Everything below it
 * streams in behind a Suspense boundary whose fallback is the design's loading state; a failed
 * load renders the design's error state, and a failed visitor query only that chart's error.
 * `?view=` opens a purely visual state (a dialog, a filter preset).
 */
export default async function ProjectDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: SearchParams;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const { user } = await requireSession();

  const header = await projectDashboard.getProjectHeader(user.id, projectId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const view = readView(query.view, PD_VIEWS, "default");

  return (
    <>
      <LiveRefresh />
      <Suspense
        fallback={
          <ProjectDashboardView header={header} data={null} load="loading" view="default" />
        }
      >
        <ProjectDashboardBody userId={user.id} header={header} view={view} searchParams={query} />
      </Suspense>
    </>
  );
}

async function ProjectDashboardBody({
  userId,
  header,
  view,
  searchParams,
}: {
  userId: string;
  header: ProjectHeader;
  view: PdView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const websiteId = header.project.id;
  const [experiments, visitors, sheets] = await Promise.allSettled([
    projectDashboard.getProjectExperiments(userId, websiteId),
    projectDashboard.getProjectVisitors(userId, websiteId),
    getProjectSheetsCard(userId, websiteId, searchParams),
  ]);

  // Keyed on the view so a client-side change of `?view=` starts from that state afresh.
  const key = `${websiteId}:${view}`;

  if (experiments.status === "rejected") {
    if (isAppError(experiments.reason) && experiments.reason.code === "NOT_FOUND") notFound();
    console.error("[routely] project dashboard: experiments failed", experiments.reason);
    return <ProjectDashboardView key={key} header={header} data={null} load="error" view={view} />;
  }
  if (visitors.status === "rejected") {
    console.error("[routely] project dashboard: visitors failed", visitors.reason);
  }
  if (sheets.status === "rejected") {
    console.error("[routely] project dashboard: sheets card failed", sheets.reason);
  }

  const data: ProjectDashboardData = {
    experiments: experiments.value,
    visitors:
      visitors.status === "fulfilled" && projectDashboard.hasVisitorData(visitors.value)
        ? visitors.value
        : null,
    visitorsFailed: visitors.status === "rejected",
    sheets: sheets.status === "fulfilled" ? sheets.value : null,
  };

  return <ProjectDashboardView key={key} header={header} data={data} load="data" view={view} />;
}
