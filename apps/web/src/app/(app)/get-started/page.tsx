import { redirectToCurrentProject } from "@/components/projects/current";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";

/** Legacy route → the current project's dashboard. */
export default async function GetStartedRedirect() {
  const user = await requireUser();
  return redirectToCurrentProject(user.id, (id) => routes.project(id).dashboard);
}
