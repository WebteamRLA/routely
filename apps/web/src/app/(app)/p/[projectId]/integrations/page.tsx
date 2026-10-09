import type { Metadata } from "next";
import Link from "next/link";

import { CdnPanel } from "@/components/integrations/cdn-panel";
import { getSheetsPanel } from "@/components/integrations/data";
import { readOAuthFlash } from "@/components/integrations/flash";
import { SheetsCard } from "@/components/integrations/sheets-card";
import { Banner, ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { loadProject, orNotFound } from "@/components/settings/data";
import { SettingsShell } from "@/components/settings/settings-shell";
import { demoState } from "@/lib/demo-state";
import { routes, type IntegrationsTab } from "@/lib/routes";
import * as cdnService from "@/server/services/cdn.service";

import IntegrationsLoading from "./loading";

export const metadata: Metadata = { title: "Integrations" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Integrations: Google Sheets (`?tab=sheets`, default) and CDN delivery (`?tab=cdn`), shown as
 * those two tabs of the design's Settings page.
 */
export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ projectId }, sp] = await Promise.all([params, searchParams]);
  const tab: IntegrationsTab = sp.tab === "cdn" ? "cdn" : "sheets";
  const demo = tab === "sheets" ? demoState(sp) : "normal";
  if (demo === "loading") return <IntegrationsLoading />;

  const { userId, project } = await loadProject(projectId);
  const r = routes.project(project.id);
  const flash = readOAuthFlash(sp);

  const [sheets, cdn] = await Promise.all([
    tab === "sheets" ? getSheetsPanel(userId, project.id) : null,
    tab === "cdn" ? orNotFound(() => cdnService.getCdnOverview(userId, project.id)) : null,
  ]);

  return (
    <SettingsShell projectId={project.id} projectName={project.name} active={tab}>
      {flash ? (
        <Banner tone={flash.tone}>
          <span className="font-extrabold">{flash.title}</span>{" "}
          <span className="font-medium">{flash.body}</span>
        </Banner>
      ) : null}
      {demo === "error" ? (
        <ErrorCard
          eyebrow="Google Sheets"
          title="We couldn’t load the Google Sheets connection"
          body="Something went wrong on our side. Syncing is not affected by this page."
          action={
            <Button variant="dark" asChild>
              <Link href={r.integrations()}>Retry</Link>
            </Button>
          }
        />
      ) : sheets ? (
        <SheetsCard
          projectId={project.id}
          projectName={project.name}
          timezone={project.timezone}
          data={
            demo === "empty"
              ? { ...sheets, configured: true, connection: null, destination: null }
              : sheets
          }
        />
      ) : null}
      {cdn ? <CdnPanel projectId={project.id} overview={cdn} timezone={project.timezone} /> : null}
    </SettingsShell>
  );
}
