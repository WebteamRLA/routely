import type { Metadata } from "next";
import { Suspense } from "react";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { LiveRefresh } from "@/components/rt/live-refresh";
import { DASHBOARD_VIEWS, type DashboardViewName } from "@/lib/dashboard";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { getAccountOverview } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Dashboard — the active workspace at a glance: totals, then its top projects' experiments,
 * traffic and tracking health (`dashboard.service.getAccountOverview`). A workspace with no
 * projects keeps the totals and gets the first-project onboarding below them.
 *
 * The data streams in behind a Suspense boundary whose fallback is the design's loading state; a
 * failed load renders the design's error state with a working "Try again". `?view=` opens the
 * onboarding dialog states, and only where the workspace really has no projects.
 */
export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { view } = await searchParams;
  const initial = readView(view, DASHBOARD_VIEWS, "data");
  return (
    <>
      <LiveRefresh />
      <Suspense fallback={<DashboardView view="data" data={null} load="loading" />}>
        <DashboardBody view={initial} />
      </Suspense>
    </>
  );
}

async function DashboardBody({ view }: { view: DashboardViewName }) {
  const { user } = await requireSession();
  const overview = await getAccountOverview(user.id, user.workspaceId).catch((error: unknown) => {
    console.error("[routely] dashboard: load failed", error);
    return null;
  });
  if (!overview)
    return <DashboardView key={`${view}:error`} view={view} data={null} load="error" />;
  // Keyed so switching `?view=` on the client re-initialises the screen instead of keeping state.
  return <DashboardView key={view} view={view} data={overview} load="ready" />;
}
