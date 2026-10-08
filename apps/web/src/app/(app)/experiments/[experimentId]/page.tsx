import { notFound, redirect } from "next/navigation";

import { withSearch } from "@/components/projects/current";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { getExperiment } from "@/server/services/experiment.service";

/** Legacy route → the experiment in its own project (ownership-checked; else not found). */
export default async function ExperimentRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ experimentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ experimentId }, sp, user] = await Promise.all([params, searchParams, requireUser()]);
  let projectId: string;
  try {
    projectId = (await getExperiment(user.id, experimentId)).websiteId;
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  redirect(withSearch(routes.project(projectId).experiment(experimentId), sp));
}
