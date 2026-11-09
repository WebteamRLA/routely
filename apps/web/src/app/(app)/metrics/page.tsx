import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EventsView } from "@/components/events/events-view";
import { NoProjects } from "@/components/workspace-pages/no-projects";
import type { PdProject } from "@/lib/project-dashboard";
import { routes, wizardReturnPath } from "@/lib/routes";
import type { SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { getEventLibrary } from "@/server/services/custom-event.service";
import { getProjectHeader } from "@/server/services/project-dashboard.service";
import { type ProjectChoice, listProjectChoices } from "@/server/services/project.service";

export const metadata: Metadata = { title: "Metrics" };

/**
 * Metrics: the Event Library of one project in the active workspace, with a switcher between
 * them (`?project=<id>`, else the first project). Creating, editing and deleting events works as
 * on the project's own Events page; the same view renders both.
 *
 * `?returnTo=` (a wizard reopening its draft, nothing else) adds "Back to experiment", and saving an
 * event offers to go back with it chosen as the goal. It applies only to the project asked for.
 *
 * An unknown `?project=` falls back to the first project rather than 404ing: the switcher's
 * own list is the workspace's, so a stale link from another workspace just lands somewhere useful.
 */
export default async function MetricsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireSession(routes.metrics.list);
  const params = await searchParams;
  const wanted = Array.isArray(params.project) ? params.project[0] : params.project;
  // From a wizard's goal step: offer the way back, with the event just saved.
  const returnTo = wizardReturnPath(params.returnTo);

  const projects = await listProjectChoices(user.id, user.workspaceId);
  const selected = projects.find((p) => p.id === wanted) ?? projects[0];
  if (!selected) {
    return (
      <NoProjects title="Metrics">
        Metrics are the clicks, form submissions and other actions visitors take on a project’s
        site. Add a project first, then create its events here.
      </NoProjects>
    );
  }

  const back = selected.id === wanted ? returnTo : null;
  const { project } = await getProjectHeader(user.id, selected.id).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <Suspense
      key={project.id}
      fallback={
        <EventsView
          project={project}
          data={null}
          load="loading"
          now={0}
          projects={projects}
          returnTo={back}
        />
      }
    >
      <MetricsBody userId={user.id} project={project} projects={projects} returnTo={back} />
    </Suspense>
  );
}

async function MetricsBody({
  userId,
  project,
  projects,
  returnTo,
}: {
  userId: string;
  project: PdProject;
  projects: ProjectChoice[];
  returnTo: string | null;
}) {
  const now = new Date();
  const library = await getEventLibrary(userId, project.id, now).catch((error) => {
    console.error("[routely] event library failed", error);
    return null;
  });

  return (
    <EventsView
      key={project.id}
      project={project}
      data={library}
      load={library ? "data" : "error"}
      now={now.getTime()}
      projects={projects}
      returnTo={returnTo}
    />
  );
}
