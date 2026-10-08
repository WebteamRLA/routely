import { redirectToCurrentProject, withSearch } from "@/components/projects/current";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";

/** Legacy route → the current project's experiments list (query kept). */
export default async function ExperimentsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  return redirectToCurrentProject(user.id, (id) =>
    withSearch(routes.project(id).experiments(), sp),
  );
}
