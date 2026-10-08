import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LAST_PROJECT_COOKIE, routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/view-models";
import * as websiteService from "@/server/services/website.service";

/**
 * The project a request without one in its URL should open: the `rl_project` cookie's project
 * when the actor owns it and it is not archived, else the first active project, else null.
 *
 * The cookie holds only an id and grants nothing — ownership comes from `listProjects`, which is
 * scoped to the actor.
 */
export async function currentProject(
  actorUserId: string,
  projects?: ProjectSummary[],
): Promise<ProjectSummary | null> {
  const list = projects ?? (await websiteService.listProjects(actorUserId));
  const active = list.filter((p) => !p.archived);
  const remembered = (await cookies()).get(LAST_PROJECT_COOKIE)?.value;
  return active.find((p) => p.id === remembered) ?? active[0] ?? null;
}

/**
 * Redirects to a page of the current project (`build(projectId)`), or to Manage projects when
 * the actor has no active project. Used by `/` and every legacy route.
 */
export async function redirectToCurrentProject(
  actorUserId: string,
  build: (projectId: string) => string,
): Promise<never> {
  const project = await currentProject(actorUserId);
  redirect(project ? build(project.id) : routes.projects);
}

/** Re-attaches a legacy route's query string to its new location. */
export function withSearch(
  path: string,
  sp: Record<string, string | string[] | undefined>,
  drop: string[] = [],
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (drop.includes(key) || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const search = params.toString();
  if (!search) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${search}`;
}
