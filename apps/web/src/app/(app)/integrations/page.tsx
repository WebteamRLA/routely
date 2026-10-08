import { redirectToCurrentProject, withSearch } from "@/components/projects/current";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";

/**
 * Legacy route → the current project's Integrations. The query string is kept so flash
 * parameters (e.g. from the Google OAuth callback) still reach the page.
 */
export default async function IntegrationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  return redirectToCurrentProject(user.id, (id) =>
    withSearch(routes.project(id).integrations(), sp),
  );
}
