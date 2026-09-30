import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Globe, Plus } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ExperimentWizard } from "@/components/experiments/wizard/experiment-wizard";
import { AddWebsiteDialog } from "@/components/websites/add-website-dialog";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { routes } from "@/lib/routes";
import { createExperimentAction } from "@/server/actions/experiment.actions";
import { verifyPixelAction } from "@/server/actions/pixel.actions";
import { requireUser } from "@/server/auth/session";
import * as experimentService from "@/server/services/experiment.service";
import * as websiteService from "@/server/services/website.service";

export const metadata: Metadata = { title: "New experiment" };

export default async function NewExperimentPage({
  searchParams,
}: {
  searchParams: Promise<{ websiteId?: string }>;
}) {
  const user = await requireUser();
  const [{ websiteId }, websites, activeExperiments] = await Promise.all([
    searchParams,
    websiteService.listWebsites(user.id),
    experimentService.listAllExperiments(user.id, { status: "ACTIVE" }),
  ]);

  // Only the actor's own websites are offered, and the action re-checks ownership anyway —
  // a websiteId typed into the query string cannot select somebody else's website.
  const preselected = websites.find((website) => website.id === websiteId);
  const backHref = preselected ? routes.websites.detail(preselected.id) : routes.experiments.list;

  return (
    /*
     * Held to 1000px and centred in the content area, against the full-width shell every other
     * page uses.
     *
     * The wizard is a form, not a table: its inputs have a natural size, so the extra width a
     * wide monitor offers is width the fields cannot use. Centring keeps the column in the
     * middle of the space it has rather than hugging the sidebar, which is what a single
     * focused task wants — the trade being that it no longer shares a left edge with the pages
     * around it.
     */
    <div className="mx-auto w-full max-w-[1000px] space-y-6">
      <PageHeader
        eyebrow={
          <Link href={backHref} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            {preselected ? preselected.name : "Experiments"}
          </Link>
        }
        title="New experiment"
        description="Send half your visitors to an alternative page and compare which one converts better."
      />

      {websites.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Add a website first"
          description="An experiment belongs to a website, which is what supplies the tracking snippet and the domain its URLs must be on."
          action={
            <AddWebsiteDialog
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Add website
                </Button>
              }
            />
          }
        />
      ) : (
        <ExperimentWizard
          action={createExperimentAction}
          websites={websites.map(({ id, name, domain, protocol, publicSiteId }) => ({
            id,
            name,
            domain,
            protocol,
            publicSiteId,
          }))}
          sdkUrl={env.SDK_URL}
          verifyAction={verifyPixelAction}
          activeExperiments={activeExperiments.map((experiment) => ({
            id: experiment.id,
            name: experiment.name,
            websiteId: experiment.websiteId,
            controlUrl: experiment.controlUrl,
            controlMatchType: experiment.controlMatchType,
          }))}
          preselectedWebsiteId={preselected?.id}
        />
      )}
    </div>
  );
}
