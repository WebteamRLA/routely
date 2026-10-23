import type { Metadata } from "next";
import { Suspense } from "react";

import { ProjectsView } from "@/components/projects/projects-view";
import { LiveRefresh } from "@/components/rt/live-refresh";
import { env } from "@/env";
import { PROJECTS_VIEWS, type ProjectsViewName } from "@/lib/projects";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import * as projectService from "@/server/services/project.service";

export const metadata: Metadata = { title: "Projects" };

/**
 * Projects — one row per website in the active workspace, with its tracking health, experiments
 * and traffic (`project.service.listProjectsWithStats`). Create, edit, delete and the install
 * check are Server Actions (`website.actions.ts`).
 *
 * The table streams in behind a Suspense boundary whose fallback is the design's loading state;
 * a failed load renders the design's error state with a working "Try again". `?view=` opens a
 * purely visual state (a dialog, a prefilled search).
 */
export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const { view } = await searchParams;
  const initial = readView(view, PROJECTS_VIEWS, "list");
  return (
    <>
      <LiveRefresh />
      <Suspense fallback={<ProjectsView view="list" data={null} load="loading" />}>
        <ProjectsBody view={initial} />
      </Suspense>
    </>
  );
}

async function ProjectsBody({ view }: { view: ProjectsViewName }) {
  const { user } = await requireSession();
  const overview = await projectService
    .listProjectsWithStats(user.id, user.workspaceId)
    .catch((error: unknown) => {
      console.error("[routely] projects: load failed", error);
      return null;
    });
  if (!overview) return <ProjectsView key={`${view}:error`} view={view} data={null} load="error" />;
  // Keyed so switching `?view=` on the client re-initialises the screen instead of keeping state.
  return (
    <ProjectsView key={view} view={view} data={{ ...overview, sdkUrl: env.SDK_URL }} load="ready" />
  );
}
