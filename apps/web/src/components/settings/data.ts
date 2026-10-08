import "server-only";

import { notFound } from "next/navigation";

import type { ProjectSettings } from "@/lib/view-models";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as websiteService from "@/server/services/website.service";

/** Runs an ownership-scoped service call; a NOT_FOUND (someone else's id) becomes the 404 page. */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

/** The signed-in user and their project, or the 404 page when they don't own it. */
export async function loadProject(
  projectId: string,
): Promise<{ userId: string; project: ProjectSettings }> {
  const user = await requireUser();
  const project = await orNotFound(() => websiteService.getProject(user.id, projectId));
  return { userId: user.id, project };
}
