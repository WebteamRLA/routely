import type { Metadata } from "next";
import Link from "next/link";

import { OverviewCards } from "@/components/get-started/overview-cards";
import { OverviewChartCards } from "@/components/get-started/overview-charts";
import { WebsitesTable } from "@/components/websites/websites-table";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { routes } from "@/lib/routes";
import { verifyPixelAction } from "@/server/actions/pixel.actions";
import { deleteWebsitesAction } from "@/server/actions/website.actions";
import { requireUser } from "@/server/auth/session";
import * as overviewService from "@/server/services/overview.service";
import * as websiteService from "@/server/services/website.service";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard (the `/get-started` route, labelled "Dashboard" in the nav): the account's
 * figures, its websites and their install state.
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

  // The headline names the one thing most worth doing next, from the same rows the figures below
  // are built from — never a claim the page cannot back up.
  const needsSetup = entries.filter((entry) => entry.pixelStatus === "unknown").length;
  const title =
    entries.length === 0
      ? "Add your first website to start testing."
      : needsSetup > 0
        ? `${needsSetup} website${needsSetup === 1 ? " still needs" : "s still need"} the snippet.`
        : stats.liveExperiments > 0
          ? `${stats.liveExperiments} experiment${stats.liveExperiments === 1 ? " is" : "s are"} collecting data.`
          : "Everything is installed. Launch an experiment when you're ready.";

  return (
    <>
      {/* Written out rather than through `PageHeader`, whose title truncates to one line: this
          one is a sentence, and the design lets it wrap. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Overview · all websites</p>
          <h1 className="mt-2 mb-1 font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em] text-pretty">
            {title}
          </h1>
          <p className="text-sm text-pretty text-ink-3">
            Install the Routely snippet on each website, then run experiments on it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={routes.experiments.list}>All experiments</Link>
          </Button>
          <Button asChild>
            <Link href={routes.experiments.new()}>New experiment</Link>
          </Button>
        </div>
      </header>

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
