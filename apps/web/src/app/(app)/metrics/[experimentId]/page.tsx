import { notFound, redirect } from "next/navigation";

import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { getExperiment } from "@/server/services/experiment.service";

/** Legacy goal-setup route → the experiment's Setup tab in its own project. */
export default async function MetricsExperimentRedirect({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const [{ experimentId }, user] = await Promise.all([params, requireUser()]);
  let projectId: string;
  try {
    projectId = (await getExperiment(user.id, experimentId)).websiteId;
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  redirect(routes.project(projectId).experiment(experimentId, { tab: "setup" }));
}
