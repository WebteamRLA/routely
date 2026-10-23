import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExperimentsView } from "@/components/experiments-list/experiments-view";
import { LiveRefresh } from "@/components/rt/live-refresh";
import { EXPERIMENTS_VIEWS } from "@/lib/experiment-list";
import { routes } from "@/lib/routes";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { readViewerTimeZone } from "@/server/http/viewer-time-zone";
import { type ExperimentList, listExperiments } from "@/server/services/experiment-results.service";

export const metadata: Metadata = { title: "Experiments" };

/**
 * Every experiment the viewer can see in the active workspace, or in one project with
 * `?project=<id>`: search, type and status filters, and pause/resume.
 *
 * A project the viewer is not a member of is a 404, like any record in another workspace. A
 * failure to load renders the design's error panel, whose Retry re-requests the page. `?view=`
 * still opens the design's purely visual states (loading skeleton, error, empty, no-results, the
 * pause confirm) for comparison with the prototype.
 */
export default async function ExperimentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireSession(routes.experiments.list);
  const params = await searchParams;
  const view = readView(params.view, EXPERIMENTS_VIEWS, "data");
  const project = Array.isArray(params.project) ? params.project[0] : params.project;
  const timeZone = await readViewerTimeZone();

  let list: ExperimentList | null = null;
  try {
    list = await listExperiments(
      user.id,
      { workspaceId: user.workspaceId, ...(project ? { projectId: project } : {}) },
      { timeZone },
    );
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    console.error("experiments list failed", error);
  }

  return (
    <>
      <LiveRefresh />
      {/* Keyed so following a link to another `?view=` starts that state fresh. */}
      <ExperimentsView
        key={view}
        view={view}
        failed={list === null}
        items={list?.items ?? []}
        canEdit={list?.canEdit ?? false}
        projectId={list?.project?.id ?? null}
        timeZone={timeZone}
      />
    </>
  );
}
