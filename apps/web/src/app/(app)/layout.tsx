import { AppShell } from "@/components/layout/app-shell";
import { currentProject } from "@/components/projects/current";
import { requireSession } from "@/server/auth/session";
import * as websiteService from "@/server/services/website.service";

/**
 * The authorization boundary for the entire dashboard.
 *
 * Gating happens here — in a Server Component that runs before any child renders — rather
 * than in `proxy.ts`, because proxy runs on cached and prefetched requests too and the
 * Next.js docs explicitly warn against treating it as a session-management layer. Pages that
 * load user data still call `requireUser()` in their service calls, so authorization is
 * enforced at the data layer as well and never depends on the layout alone.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // The switcher's projects, ownership-scoped like every other read.
  const projects = await websiteService.listProjects(session.user.id);
  const remembered = await currentProject(session.user.id, projects);

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email, image: session.user.image }}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        domain: p.domain,
        domains: p.domains,
        iconUrl: p.iconUrl,
        archived: p.archived,
        experiments: p.counts.total,
      }))}
      rememberedProjectId={remembered?.id ?? null}
    >
      {children}
    </AppShell>
  );
}
