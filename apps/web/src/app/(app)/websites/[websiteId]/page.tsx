import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SheetStatusColumn } from "@/components/integrations/sheet-status";
import { WebsiteSheetCard } from "@/components/integrations/website-sheet-card";
import { ExperimentStatusBadge } from "@/components/experiments/status-badge";
import { PublishPauseButton } from "@/components/experiments/publish-pause-button";
import { PageHeader } from "@/components/common/page-header";
import { PixelSetupDialog } from "@/components/get-started/pixel-setup-dialog";
import { CopyValue } from "@/components/websites/copy-value";
import { DeleteWebsiteDialog } from "@/components/websites/delete-website-dialog";
import { PixelStatusBadge } from "@/components/websites/pixel-status-badge";
import { WebsiteForm } from "@/components/websites/website-form";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { formatDate } from "@/lib/format";
import { PIXEL_STATUS, resolvePixelStatus } from "@/lib/pixel-status";
import { routes } from "@/lib/routes";
import { siteOrigin } from "@/lib/site-url";
import { cn } from "@/lib/utils";
import {
  attachPickedSheetAction,
  createSheetAction,
  detachSheetAction,
  getPickerTokenAction,
  refreshSheetAction,
} from "@/server/actions/integration.actions";
import { changeExperimentStatusAction } from "@/server/actions/experiment.actions";
import { verifyPixelAction } from "@/server/actions/pixel.actions";
import { deleteWebsiteAction, updateWebsiteAction } from "@/server/actions/website.actions";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as experimentService from "@/server/services/experiment.service";
import { getWebsiteSheetStatus } from "@/server/services/sheets-sync.service";
import * as websiteService from "@/server/services/website.service";

export const metadata: Metadata = { title: "Website" };

/**
 * Website detail, drawn as the design's settings page: one column of white sections, each with
 * a heading and labelled fields — identity and details, domain, installation, experiments,
 * the Sheets export, and a danger zone last.
 *
 * Snippet installation is not repeated here: the Installation section opens the same install
 * panel the dashboard uses, so there is one set of instructions and one verify path. Two
 * copies of the same instructions is exactly how they drift apart.
 */

/** A settings section: white card, 22px padding, Sora heading with optional meta and action. */
function Section({
  title,
  description,
  aside,
  tone = "default",
  flush = false,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  tone?: "default" | "danger";
  /** Body runs edge to edge (a table) rather than inside the 22px padding. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        tone === "danger" ? "border-danger-border" : "border-border",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 px-[22px] pt-5",
          flush ? "border-b border-divider pb-4" : "pb-0",
        )}
      >
        <div className="min-w-0 flex-[1_1_320px]">
          <h2
            className={cn(
              "font-heading text-[15.5px] font-bold tracking-[-0.01em]",
              tone === "danger" && "text-danger-text",
            )}
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] text-pretty text-ink-3">{description}</p>
          ) : null}
        </div>
        {aside}
      </div>
      <div className={flush ? "" : "px-[22px] pt-4 pb-[22px]"}>{children}</div>
    </section>
  );
}

/** A read-only labelled value, matching the form fields' 13px heavy label. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <dt className="text-[13px] font-extrabold">{label}</dt>
      <dd className="text-[13.5px] text-ink-2">{children}</dd>
    </div>
  );
}

export default async function WebsitePage({ params }: { params: Promise<{ websiteId: string }> }) {
  const user = await requireUser();
  const { websiteId } = await params;

  // The service scopes by actor, so an id belonging to someone else raises NOT_FOUND — the
  // same response as an id that does not exist, which is what keeps ids unprobeable.
  const website = await websiteService.getWebsite(user.id, websiteId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  // Fetched together: both describe the same website, and the sheet status makes no Google call.
  const [experiments, sheetStatus, receivingData] = await Promise.all([
    experimentService.listExperiments(user.id, website.id),
    getWebsiteSheetStatus(user.id, website.id),
    websiteService.isReceivingData(user.id, website.id),
  ]);
  const pixelStatus = resolvePixelStatus(receivingData, website.pixelVerifiedAt);
  const activeCount = experiments.filter((experiment) => experiment.status === "ACTIVE").length;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]">
      <PageHeader
        eyebrow={
          <Link href={routes.getStarted} className="hover:text-foreground">
            ← Dashboard
          </Link>
        }
        title={website.name}
        description={`Details, installation and integrations for ${website.domain}.`}
        actions={
          <Button asChild>
            <Link href={routes.experiments.new(website.id)}>New experiment</Link>
          </Button>
        }
      />

      <Section
        title="Website"
        description="Renaming a website or correcting its domain does not change the public site id, so your installed snippet keeps working."
      >
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3.5 border-b border-divider pb-5">
          <Fact label="Public site id">
            <CopyValue value={website.publicSiteId} label="Copy public site id" />
          </Fact>
          <Fact label="Created">
            <time dateTime={website.createdAt.toISOString()}>{formatDate(website.createdAt)}</time>
          </Fact>
          <Fact label="Experiments">
            <span className="tabular-nums">{experiments.length}</span>
            {activeCount > 0 ? (
              <span className="ml-2 rounded-sm bg-success-bg px-1.5 py-0.5 text-[11.5px] font-extrabold text-success-text">
                {activeCount} active
              </span>
            ) : null}
          </Fact>
        </dl>

        <div className="pt-5">
          <WebsiteForm
            action={updateWebsiteAction}
            websiteId={website.id}
            defaultName={website.name}
            defaultDomain={website.domain}
            defaultProtocol={website.protocol}
            submitLabel="Save changes"
            pendingLabel="Saving…"
          />
        </div>
      </Section>

      <Section
        title="Domain"
        description="Experiments can only run, and conversions can only be attributed, on this domain and its subdomains."
      >
        <div className="flex items-center gap-2.5 rounded-lg border border-divider px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
            {siteOrigin(website)}
          </span>
          <span className="rounded-[5px] bg-brand-tint-2 px-[7px] py-0.5 text-[11px] font-extrabold text-[#2347C8]">
            PRIMARY
          </span>
        </div>
        <p className="mt-2.5 text-[12.5px] text-ink-3">Change it in the Website section above.</p>
      </Section>

      <Section
        title="Installation"
        description="Install the snippet once on this website. The same snippet powers every experiment on it."
        aside={<PixelStatusBadge status={pixelStatus} />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-[1_1_280px] text-[13px] text-pretty text-ink-2">
            {PIXEL_STATUS[pixelStatus].hint}.
          </p>
          <PixelSetupDialog
            website={website}
            sdkUrl={env.SDK_URL}
            verifyAction={verifyPixelAction}
            triggerLabel={pixelStatus === "unknown" ? "Set up pixel" : "Re-check pixel"}
            triggerVariant={pixelStatus === "unknown" ? "default" : "outline"}
            alreadySetUp={pixelStatus !== "unknown"}
            pixelStatus={pixelStatus}
          />
        </div>
      </Section>

      <Section
        title="Experiments"
        description={
          experiments.length === 0
            ? undefined
            : `${experiments.length} on this website${activeCount > 0 ? ` · ${activeCount} active` : ""}`
        }
        aside={
          <Link
            href={routes.experiments.new(website.id)}
            className="text-[13px] font-bold whitespace-nowrap text-primary hover:text-brand-hover"
          >
            New experiment →
          </Link>
        }
        flush
      >
        {experiments.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-[22px] py-6">
            <p className="max-w-md text-[13.5px] text-pretty text-ink-3">
              No experiments yet. Create one to send part of your visitors to an alternative page
              and compare the two.
            </p>
            <Button size="sm" asChild>
              <Link href={routes.experiments.new(website.id)}>New experiment</Link>
            </Button>
          </div>
        ) : (
          <ul>
            {experiments.map((experiment) => (
              /* The publish/pause control sits outside the row's link rather than inside it — a
                 button nested in an anchor is invalid HTML, and clicking it would follow the
                 link as well as submitting. */
              <li
                key={experiment.id}
                className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-divider px-[22px] py-3 transition-colors last:border-b-0 hover:bg-subtle"
              >
                <Link
                  href={routes.experiments.detail(experiment.id)}
                  className="min-w-0 flex-[1_1_220px] rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-primary/15"
                >
                  <span className="block truncate text-[13.5px] font-bold">{experiment.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-3">
                    {experiment.controlUrl}
                  </span>
                </Link>
                <span className="hidden text-[12px] whitespace-nowrap text-ink-3 md:block">
                  {experiment.publishedAt
                    ? `Published ${formatDate(experiment.publishedAt)}`
                    : `Created ${formatDate(experiment.createdAt)}`}
                </span>
                <ExperimentStatusBadge status={experiment.status} />
                <PublishPauseButton
                  action={changeExperimentStatusAction}
                  experimentId={experiment.id}
                  status={experiment.status}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Google Sheets"
        description="Routely keeps a spreadsheet up to date with this website’s last 30 days of results — one row per experiment arm per day, refreshed within seconds of a visit or a conversion. Optional."
      >
        {!sheetStatus.configured ? (
          <p className="text-[13px] text-ink-3">
            This integration is not configured on this deployment.
          </p>
        ) : !sheetStatus.connected ? (
          <p className="text-[13px] text-ink-3">
            Connect your Google account once on the{" "}
            <Link href={routes.integrations} className="font-bold text-primary">
              Integrations
            </Link>{" "}
            page, then you can attach a spreadsheet here without signing in again.
          </p>
        ) : (
          <div className="space-y-4">
            {sheetStatus.needsReconnect ? (
              <p className="rounded-lg border border-danger-border bg-danger-bg-2 px-3.5 py-2.5 text-[13px] text-danger-text">
                Google access has stopped working.{" "}
                <Link href={routes.integrations} className="font-bold underline">
                  Reconnect
                </Link>{" "}
                to resume the daily sync. This website keeps its spreadsheet.
              </p>
            ) : null}

            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-[13px] font-extrabold">Destination</p>
              <SheetStatusColumn destination={sheetStatus.destination} />
            </div>

            <WebsiteSheetCard
              websiteId={website.id}
              destination={sheetStatus.destination}
              developerKey={env.NEXT_PUBLIC_GOOGLE_API_KEY}
              projectNumber={env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER}
              getPickerToken={getPickerTokenAction}
              attachSheet={attachPickedSheetAction}
              createSheetAction={createSheetAction}
              detachSheetAction={detachSheetAction}
              refreshSheetAction={refreshSheetAction}
              canSync={!sheetStatus.needsReconnect}
            />
          </div>
        )}
      </Section>

      <Section title="Danger zone" tone="danger">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[13.5px] font-bold">Delete this website</p>
            <p className="text-[13px] text-pretty text-ink-3">
              Removes the website and every experiment, visitor and conversion recorded under it.
              This cannot be undone.
            </p>
          </div>
          <DeleteWebsiteDialog
            action={deleteWebsiteAction}
            websiteId={website.id}
            websiteName={website.name}
            experimentCount={experiments.length}
          />
        </div>
      </Section>
    </div>
  );
}
