import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EventsView } from "@/components/events/events-view";
import type { PdProject } from "@/lib/project-dashboard";
import { requireSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { getEventLibrary } from "@/server/services/custom-event.service";
import { getProjectHeader } from "@/server/services/project-dashboard.service";

export const metadata: Metadata = { title: "Events" };

/**
 * A project's Event Library.
 *
 * The header is loaded first and doubles as the access check, so a project in someone else's
 * workspace is a real 404 before anything streams. The library streams in behind it, and a failed
 * load renders the screen's own error state with a retry.
 */
export default async function ProjectEventsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { user } = await requireSession();

  const { project } = await getProjectHeader(user.id, projectId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <Suspense fallback={<EventsView project={project} data={null} load="loading" now={0} />}>
      <EventsBody userId={user.id} project={project} />
    </Suspense>
  );
}

async function EventsBody({ userId, project }: { userId: string; project: PdProject }) {
  const now = new Date();
  const library = await getEventLibrary(userId, project.id, now).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    console.error("[routely] event library failed", error);
    return null;
  });

  return (
    <EventsView
      project={project}
      data={library}
      load={library ? "data" : "error"}
      now={now.getTime()}
    />
  );
}
