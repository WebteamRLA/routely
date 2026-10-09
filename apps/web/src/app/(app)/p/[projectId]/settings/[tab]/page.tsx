import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Section } from "@/components/rl";
import { loadProject, orNotFound } from "@/components/settings/data";
import { DomainsCard } from "@/components/settings/domains-card";
import { ProjectCard } from "@/components/settings/project-card";
import { SettingsShell } from "@/components/settings/settings-shell";
import { TeamCard } from "@/components/settings/team-card";
import { installInfoFor } from "@/components/tracking/data";
import { InstallPanel } from "@/components/tracking/install-panel";
import type { SettingsTab } from "@/lib/routes";
import * as memberService from "@/server/services/member.service";

export const metadata: Metadata = { title: "Settings" };

const TABS: SettingsTab[] = ["project", "install", "team"];

function isTab(value: string): value is SettingsTab {
  return TABS.includes(value as SettingsTab);
}

/**
 * Settings (DESIGN.md 2.7): Project · Installation & tracking · Team. The shell's other tabs
 * (metrics, GTM, Sheets, CDN) link to the Metrics & goals and Integrations routes.
 */
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
    <SettingsShell projectId={project.id} projectName={project.name} active={tab}>
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
    </SettingsShell>
  );
}
