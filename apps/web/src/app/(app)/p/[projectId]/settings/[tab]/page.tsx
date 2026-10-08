import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageTitle, Section, SideTabs } from "@/components/rl";
import { loadProject, orNotFound } from "@/components/settings/data";
import { DomainsCard } from "@/components/settings/domains-card";
import { ProjectCard } from "@/components/settings/project-card";
import { TeamCard } from "@/components/settings/team-card";
import { installInfoFor } from "@/components/tracking/data";
import { InstallPanel } from "@/components/tracking/install-panel";
import { routes, type SettingsTab } from "@/lib/routes";
import * as memberService from "@/server/services/member.service";

export const metadata: Metadata = { title: "Settings" };

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "project", label: "Project" },
  { key: "install", label: "Installation & tracking" },
  { key: "team", label: "Team" },
];

function isTab(value: string): value is SettingsTab {
  return TABS.some((t) => t.key === value);
}

/** Settings (DESIGN.md 2.7): Project · Installation & tracking · Team. */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string; tab: string }>;
}) {
  const { projectId, tab } = await params;
  if (!isTab(tab)) notFound();

  const { userId, project } = await loadProject(projectId);
  const members =
    tab === "team" ? await orNotFound(() => memberService.listMembers(userId, project.id)) : [];

  return (
    <div className="mx-auto flex w-full max-w-[1200px] animate-rl-in flex-col gap-[18px]">
      <PageTitle title="Settings" sub={`Project, tracking and integrations for ${project.name}.`} />
      <div className="flex flex-col gap-5 nav:flex-row nav:items-start">
        <SideTabs
          className="min-w-0 nav:w-[220px] nav:shrink-0"
          active={tab}
          tabs={TABS.map((t) => ({ ...t, href: routes.project(project.id).settings(t.key) }))}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {tab === "project" ? (
            <>
              <ProjectCard
                key={`${project.name}|${project.timezone}|${project.significanceThreshold}`}
                projectId={project.id}
                name={project.name}
                timezone={project.timezone}
                threshold={project.significanceThreshold}
              />
              <DomainsCard projectId={project.id} domains={project.domains} />
            </>
          ) : null}
          {tab === "install" ? (
            <Section>
              <InstallPanel install={installInfoFor(project)} projectName={project.name} />
            </Section>
          ) : null}
          {tab === "team" ? <TeamCard projectId={project.id} members={members} /> : null}
        </div>
      </div>
    </div>
  );
}
