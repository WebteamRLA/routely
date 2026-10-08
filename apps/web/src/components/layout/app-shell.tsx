"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { requestLeave } from "@/components/layout/leave-guard";
import { MobileNav } from "@/components/layout/mobile-nav";
import { buildNav } from "@/components/layout/nav-items";
import { ShellContext, type ShellApi } from "@/components/layout/shell-context";
import { Sidebar } from "@/components/layout/sidebar";
import type { ShellProject, ShellUser } from "@/components/layout/types";
import { ProjectModal, type ProjectModalMode } from "@/components/projects/project-modal";
import { routes } from "@/lib/routes";
import { selectProjectAction } from "@/server/actions/project.actions";
import { signOutAction } from "@/server/auth/actions";

/**
 * Dashboard chrome, as the prototype draws it (DESIGN.md §1): a sticky 240px navy sidebar beside
 * a document-scrolling content column on desktop; a 56px top bar plus drawer below 900px.
 *
 * The "current project" is the one in the URL (`/p/[projectId]/…`). Pages without one (Manage
 * projects) keep pointing at the last project opened in this tab, else the server's choice
 * (cookie `rl_project`, else the first active project). Whenever the URL's project differs from
 * the remembered one, `selectProjectAction` re-points the cookie so `/` returns here.
 */
export function AppShell({
  user,
  projects,
  rememberedProjectId,
  children,
}: {
  user: ShellUser;
  projects: ShellProject[];
  /** The project the cookie names (validated server-side), or the fallback. */
  rememberedProjectId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();
  const routeProjectId = typeof params.projectId === "string" ? params.projectId : null;

  // Last project seen in a URL (this tab), so /projects keeps the context it was opened from.
  const [lastRouteProjectId, setLastRouteProjectId] = useState<string | null>(routeProjectId);
  if (routeProjectId && routeProjectId !== lastRouteProjectId)
    setLastRouteProjectId(routeProjectId);

  const byId = useCallback(
    (id: string | null) => projects.find((p) => p.id === id) ?? null,
    [projects],
  );
  const current =
    byId(routeProjectId) ??
    byId(lastRouteProjectId) ??
    byId(rememberedProjectId) ??
    projects.find((p) => !p.archived) ??
    null;

  // Keep the `rl_project` cookie pointing at the project being viewed.
  const selected = useRef<string | null>(rememberedProjectId);
  useEffect(() => {
    if (!routeProjectId || selected.current === routeProjectId) return;
    selected.current = routeProjectId;
    void selectProjectAction(routeProjectId);
  }, [routeProjectId]);

  // A project the shell has not heard of (just created in another layout render): the persisted
  // layout's list is stale, so fetch it again — once per id.
  const refreshedFor = useRef<string | null>(null);
  const known = !routeProjectId || projects.some((p) => p.id === routeProjectId);
  useEffect(() => {
    if (known || refreshedFor.current === routeProjectId) return;
    refreshedFor.current = routeProjectId;
    router.refresh();
  }, [known, routeProjectId, router]);

  const [modal, setModal] = useState<ProjectModalMode | null>(null);

  const api = useMemo<ShellApi>(
    () => ({
      projects,
      current,
      switchProject(projectId) {
        const target = projects.find((p) => p.id === projectId && !p.archived);
        if (!target) return;
        if (projectId === routeProjectId) {
          router.push(routes.project(projectId).dashboard);
          return;
        }
        requestLeave(
          "switch",
          () => {
            selected.current = projectId;
            void selectProjectAction(projectId).then((result) => {
              if (result.status === "error") {
                toast.error(result.message);
                return;
              }
              router.push(routes.project(projectId).dashboard);
              toast(`Switched to ${target.name}`);
            });
          },
          target.name,
        );
      },
      logout() {
        requestLeave("logout", () => void signOutAction());
      },
      openCreateProject: () => setModal({ kind: "create" }),
      openEditProject: (project) => setModal({ kind: "edit", project }),
    }),
    [projects, current, routeProjectId, router],
  );

  const nav = buildNav(pathname, current?.id ?? null, {
    experiments: current?.experiments ?? 0,
    projects: projects.filter((p) => !p.archived).length,
  });

  return (
    <ShellContext.Provider value={api}>
      <div className="flex min-h-screen bg-background text-foreground">
        <Sidebar user={user} nav={nav} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav user={user} nav={nav} />
          <main className="min-w-0 flex-1 px-[clamp(16px,3.2vw,40px)] pt-7 pb-[110px]">
            {children}
          </main>
        </div>
      </div>
      <ProjectModal mode={modal} projects={projects} onClose={() => setModal(null)} />
    </ShellContext.Provider>
  );
}
