import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { LiveRefresh } from "@/components/rt/live-refresh";
import { env } from "@/env";
import { DASHBOARD_VIEWS, type DashboardViewName } from "@/lib/dashboard";
import type { ProjectSheetsCard } from "@/lib/sheets-card";
import { GUIDE_HIDDEN_COOKIE, SHEETS_SKIPPED_COOKIE, showsChecklist } from "@/lib/onboarding";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { getAccountOverview } from "@/server/services/dashboard.service";
import { getProjectSheetsCard } from "@/server/services/sheets-sync.service";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Dashboard — the active workspace at a glance: totals, then its top projects' experiments,
 * traffic and tracking health (`dashboard.service.getAccountOverview`). A workspace with no
 * projects keeps the totals and gets the first-project onboarding below them.
 *
 * The data streams in behind a Suspense boundary whose fallback is the design's loading state; a
 * failed load renders the design's error state with a working "Try again". `?view=` opens the
 * onboarding dialog states, and only where the workspace really has no projects.
 *
 * The Getting started checklist opens the tracking and Google Sheets dialogs right here. Google's
 * consent flow returns to `?project=<id>&sheets=<outcome>`, which reopens the Sheets dialog for
 * that project.
 */
export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const initial = readView(query.view, DASHBOARD_VIEWS, "data");
  return (
    <>
      <LiveRefresh />
      <Suspense fallback={<DashboardView view="data" data={null} load="loading" />}>
        <DashboardBody view={initial} query={query} />
      </Suspense>
    </>
  );
}

async function DashboardBody({
  view,
  query,
}: {
  view: DashboardViewName;
  query: Record<string, string | string[] | undefined>;
}) {
  const { user } = await requireSession();
  const jar = await cookies();
  const guideHidden = jar.get(GUIDE_HIDDEN_COOKIE)?.value === "1";
  const sheetsSkipped = jar.get(SHEETS_SKIPPED_COOKIE)?.value === "1";
  const overview = await getAccountOverview(user.id, user.workspaceId, {
    sheetsSkipped,
  }).catch((error: unknown) => {
    console.error("[routely] dashboard: load failed", error);
    return null;
  });
  if (!overview)
    return <DashboardView key={`${view}:error`} view={view} data={null} load="error" />;

  // The Sheets dialog's card: the project Google returned to, else the checklist's own project while
  // its Sheets step shows — loaded even once the step is done, so the dialog stays on screen after a
  // spreadsheet is attached until "Done".
  const returned = typeof query.sheets === "string" && typeof query.project === "string";
  const sheetsStep =
    showsChecklist(overview.role, overview.checklist, guideHidden) &&
    overview.checklist.steps.some((step) => step.key === "sheets");
  const sheetsProject = returned
    ? (query.project as string)
    : sheetsStep
      ? overview.checklist.homeProjectId
      : null;
  const sheetsCard: ProjectSheetsCard | null = sheetsProject
    ? await getProjectSheetsCard(user.id, sheetsProject, returned ? query : undefined).catch(
        () => null,
      )
    : null;

  // Keyed so switching `?view=` on the client re-initialises the screen instead of keeping state.
  return (
    <DashboardView
      key={view}
      view={view}
      data={overview}
      load="ready"
      guideHidden={guideHidden}
      sdkUrl={env.SDK_URL}
      sheetsCard={sheetsCard}
    />
  );
}
