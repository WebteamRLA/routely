import type { Metadata } from "next";
import Link from "next/link";
import { Globe, Plus } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
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
     * Held to 1240px and centred in the content area, against the full-width shell every other
     * page uses: the wizard is a single focused task, a form column plus a summary rail, and the
     * extra width of a wide monitor is width its fields cannot use.
     */
    <div className="mx-auto flex w-full max-w-[1240px] animate-rl-in flex-col gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-[34px] px-3 text-[13px]">
            <Link href={backHref}>← Exit</Link>
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-extrabold tracking-[0.08em] text-coral uppercase">
              Create experiment
            </p>
            <h1 className="truncate font-heading text-xl font-semibold">
              {preselected ? `New split URL test · ${preselected.name}` : "New split URL test"}
            </h1>
          </div>
        </div>
      </div>

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
