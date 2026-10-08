import { redirect } from "next/navigation";

import { currentProject } from "@/components/projects/current";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";
import { listProjects } from "@/server/services/website.service";

/**
 * Legacy route → the wizard in the right project: `?websiteId=` when the actor owns it, else
 * the current project.
 */
export default async function NewExperimentRedirect({
  searchParams,
}: {
  searchParams: Promise<{ websiteId?: string; type?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const projects = await listProjects(user.id);
  const project =
    projects.find((p) => p.id === sp.websiteId && !p.archived) ??
    (await currentProject(user.id, projects));
  if (!project) redirect(routes.projects);
  const type = sp.type === "ab" || sp.type === "redirect" ? sp.type : undefined;
  redirect(routes.project(project.id).newExperiment(type));
}
