import { redirect } from "next/navigation";

import { redirectToCurrentProject } from "@/components/projects/current";
import { routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";

/**
 * The root path is a router, not a page: signed-in users go to their last project's dashboard
 * (cookie `rl_project`, if they still own it and it is not archived), else their first active
 * project, else Manage projects. Everyone else goes to the login screen.
 */
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect(routes.login);
  return redirectToCurrentProject(session.user.id, (id) => routes.project(id).dashboard);
}
