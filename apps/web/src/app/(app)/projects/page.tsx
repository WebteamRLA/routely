import type { Metadata } from "next";

import { ProjectsManager } from "@/components/projects/projects-manager";
import type { ProjectRowData } from "@/components/projects/types";
import { fAgo, fDate, minutesSince } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { listForProject } from "@/server/services/experiment.service";
import { listProjects } from "@/server/services/website.service";

export const metadata: Metadata = { title: "Manage projects" };

/** Manage projects (DESIGN.md §2.6). */
export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await listProjects(user.id);
  // Running experiment ids, so archiving can pause them first (only projects with any running).
  const running = await Promise.all(
    projects.map((p) =>
      p.counts.running && !p.archived
        ? listForProject(user.id, p.id, { status: "running" }).then((list) => list.map((e) => e.id))
        : Promise.resolve([] as string[]),
    ),
  );
  const now = new Date();
  const rows: ProjectRowData[] = projects.map((p, i) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
    domains: p.domains,
    iconUrl: p.iconUrl,
    archived: p.archived,
    total: p.counts.total,
    running: p.counts.running,
    runningIds: running[i] ?? [],
    activity: p.lastActivityAt
      ? `Last activity ${fAgo(minutesSince(p.lastActivityAt, now)).toLowerCase()}`
      : `Created ${fDate(p.createdAt, p.timezone)}`,
  }));
  return <ProjectsManager projects={rows} />;
}
