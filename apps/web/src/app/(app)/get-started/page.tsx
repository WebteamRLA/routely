import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { OverviewCards } from "@/components/get-started/overview-cards";
import { OverviewChartCards } from "@/components/get-started/overview-charts";
import { PageHeader } from "@/components/common/page-header";
import { WebsitesTable } from "@/components/websites/websites-table";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { routes } from "@/lib/routes";
import { verifyPixelAction } from "@/server/actions/pixel.actions";
import { deleteWebsitesAction } from "@/server/actions/website.actions";
import { requireUser } from "@/server/auth/session";
import * as overviewService from "@/server/services/overview.service";
import * as websiteService from "@/server/services/website.service";

export const metadata: Metadata = { title: "Get started" };

/**
 * The Get started entry point: the account's figures, its websites and their install state.
 *
 * The page has one shape whether or not any websites exist yet. An account on its first visit
 * sees the dashboard it will have tomorrow with one thing missing and named, rather than a
 * different screen that vanishes the moment a website is added — and the zeroes above are
 * true, not placeholders.
 *
 * Previously this scoped the whole page to one website chosen through `?websiteId=`, which
 * answered "how do I set up this site" but not "which of my sites still need setting up" —
 * the question someone with several websites actually opens this page to ask. The table shows
 * all of them at once, and each row carries its own setup dialog, so nothing has to be
 * selected first and the query param is no longer needed.
 */
export default async function GetStartedPage() {
  const user = await requireUser();
  // Fetched together: both describe the same account, and running them in sequence would make
  // the first screen after signing in wait for two round trips instead of one.
  const [entries, stats, charts] = await Promise.all([
    websiteService.listWebsitesWithStatus(user.id),
    overviewService.getOverviewStats(user.id),
    overviewService.getOverviewCharts(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Get started"
        description="Install the Routely snippet on each website, then run experiments on it."
        actions={
          <Button asChild>
            <Link href={routes.experiments.new()}>
              <Plus aria-hidden />
              New experiment
            </Link>
          </Button>
        }
      />

      <OverviewCards stats={stats} />

      <WebsitesTable
        entries={entries}
        sdkUrl={env.SDK_URL}
        verifyAction={verifyPixelAction}
        deleteAction={deleteWebsitesAction}
      />

      <OverviewChartCards charts={charts} />
    </>
  );
}
