import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, HelpCircle, Sheet, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { ConnectGoogleButton } from "@/components/integrations/connect-google-button";
import { DisconnectDialog } from "@/components/integrations/disconnect-dialog";
import { WebsiteSheetCard } from "@/components/integrations/website-sheet-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { env } from "@/env";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { SHEET_COLUMNS } from "@/lib/sheet-rows";
import {
  attachPickedSheetAction,
  createSheetAction,
  detachSheetAction,
  disconnectSheetsAction,
  getPickerTokenAction,
  listWorksheetsAction,
  syncDayAction,
} from "@/server/actions/integration.actions";
import { requireUser } from "@/server/auth/session";
import {
  getIntegrationOverview,
  type IntegrationOverview,
  type WebsiteSheetSummary,
} from "@/server/services/sheets-sync.service";

export const metadata: Metadata = { title: "Integrations" };

/**
 * Google Sheets integration.
 *
 * `/integrations` *is* this page rather than an index linking to it, because there is exactly one
 * integration — an index listing a single item is the picker-with-one-option this project has
 * rejected elsewhere.
 *
 * The shape follows how the feature actually works: **one Google connection at the top, then one
 * spreadsheet per website below it.** The customer authorises Google once; each website then points
 * at its own sheet, which is what an agency running several sites needs, and attaching one needs no
 * further consent screen.
 *
 * The read model makes no Google API calls, so the page — and in particular Disconnect — still works
 * when Google is unreachable or the grant has been revoked.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [overview, params] = await Promise.all([getIntegrationOverview(user.id), searchParams]);

  const flash = readFlash(params);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Integrations"
        description="Send your experiment results somewhere else, automatically."
      />

      {flash ? (
        <Alert variant={flash.tone === "error" ? "destructive" : "default"}>
          {flash.tone === "error" ? <AlertCircle aria-hidden /> : <CheckCircle2 aria-hidden />}
          <AlertTitle>{flash.title}</AlertTitle>
          <AlertDescription>{flash.body}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <Sheet className="size-4" aria-hidden />
                Google Sheets
              </CardTitle>
              <CardDescription>
                Once a day, Routely appends yesterday&rsquo;s results to a spreadsheet you choose —
                one per website.
              </CardDescription>
            </div>
            {overview.connection ? (
              <Badge
                variant={overview.connection.status === "CONNECTED" ? "secondary" : "destructive"}
              >
                {overview.connection.status === "CONNECTED" ? "Connected" : "Needs reconnecting"}
              </Badge>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {!overview.configured ? (
            <NotConfigured hint={overview.configurationHint} />
          ) : !overview.connection ? (
            <NotConnected />
          ) : (
            <Connected overview={overview} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Names the missing variable rather than saying "unavailable".
 *
 * Mirrors the login page's behaviour when Google credentials are absent: the person reading this is
 * whoever deployed the app, and the one thing they need is the name of what to set.
 */
function NotConfigured({ hint }: { hint: string | null }) {
  return (
    <Alert>
      <AlertCircle aria-hidden />
      <AlertTitle>This integration is not configured</AlertTitle>
      <AlertDescription>
        Set {hint ?? "the required environment variables"} to enable it. Routely will not store a
        Google refresh token without an encryption key for it.
      </AlertDescription>
    </Alert>
  );
}

function NotConnected() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">What gets written</h3>
        <p className="text-sm text-muted-foreground">
          One row per experiment arm per day, appended to the bottom of a tab you choose:
        </p>
        <div className="overflow-x-auto rounded-md border border-border/70">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {SHEET_COLUMNS.map((column) => (
                  <th key={column} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-muted-foreground">
              <tr className="border-t border-border/70">
                <td className="px-3 py-2 whitespace-nowrap">2026-09-28</td>
                <td className="px-3 py-2 whitespace-nowrap">Pricing redesign</td>
                <td className="px-3 py-2 whitespace-nowrap">Control</td>
                <td className="px-3 py-2">412</td>
                <td className="px-3 py-2">30</td>
                <td className="px-3 py-2">7.3</td>
              </tr>
              <tr className="border-t border-border/70">
                <td className="px-3 py-2 whitespace-nowrap">2026-09-28</td>
                <td className="px-3 py-2 whitespace-nowrap">Pricing redesign</td>
                <td className="px-3 py-2 whitespace-nowrap">Variant 1</td>
                <td className="px-3 py-2">408</td>
                <td className="px-3 py-2">41</td>
                <td className="px-3 py-2">10.0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">What Routely can see</h3>
        <p className="text-sm text-muted-foreground">
          Only the spreadsheets you pick, and the ones Routely creates for you. It cannot list, open
          or read anything else in your Google Drive — you choose files in Google&rsquo;s own
          picker, and Google grants access to just that file.
        </p>
        <p className="text-xs text-muted-foreground">
          Days run to UTC midnight, the same boundary every date in Routely uses. Rows are only
          appended — nothing already in your spreadsheet is edited or removed.
        </p>
      </div>

      <ConnectGoogleButton />
    </div>
  );
}

function Connected({ overview }: { overview: IntegrationOverview }) {
  const connection = overview.connection;
  if (!connection) return null;

  const attached = overview.websites.filter((website) => website.destination !== null);
  const canSync = connection.status === "CONNECTED" && connection.canUseSheets;

  const sheetProps = {
    developerKey: env.NEXT_PUBLIC_GOOGLE_API_KEY,
    projectNumber: env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
    getPickerToken: getPickerTokenAction,
    attachSheet: attachPickedSheetAction,
    listWorksheets: listWorksheetsAction,
    createSheetAction,
    detachSheetAction,
    syncDayAction,
    canSync,
  };

  return (
    <div className="space-y-6">
      {connection.status === "NEEDS_RECONNECT" ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Google access has stopped working</AlertTitle>
          <AlertDescription>
            {connection.statusDetail ?? "Reconnect your Google account to resume the daily sync."}{" "}
            The daily sync is paused until you reconnect. Every website keeps its spreadsheet and
            its history.
          </AlertDescription>
        </Alert>
      ) : null}

      {connection.status === "CONNECTED" && !connection.canUseSheets ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>A required permission was declined</AlertTitle>
          <AlertDescription>
            Routely was not given permission to create and edit the Google Sheets you choose.
            Reconnect and leave that permission ticked.
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Google account</dt>
          <dd className="font-medium">{connection.googleEmail ?? "Connected"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Connected</dt>
          <dd className="font-medium">{formatDateTime(connection.connectedAt)} UTC</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Websites syncing</dt>
          <dd className="font-medium">
            {attached.length} of {overview.websites.length}
          </dd>
        </div>
      </dl>

      <Separator />

      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Spreadsheet per website</h3>
          <p className="text-sm text-muted-foreground">
            Each website writes to its own spreadsheet. A website with none attached is simply not
            synced.
          </p>
        </div>

        {overview.websites.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              You have no websites yet. Add one and you can attach a spreadsheet to it.
            </p>
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link href={routes.getStarted}>Get started</Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-4">
            {overview.websites.map((website) => (
              <li
                key={website.websiteId}
                className="space-y-3 rounded-lg border border-border/70 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={routes.websites.detail(website.websiteId)}
                    className="font-medium hover:underline"
                  >
                    {website.websiteName}
                  </Link>
                  {website.lastRun ? (
                    <span className="text-xs">
                      <span className="font-mono text-muted-foreground">{website.lastRun.day}</span>{" "}
                      <RunSummary run={website.lastRun} />
                    </span>
                  ) : website.destination ? (
                    <span className="text-xs text-muted-foreground">Not yet run</span>
                  ) : null}
                </div>

                <WebsiteSheetCard
                  websiteId={website.websiteId}
                  destination={website.destination}
                  {...sheetProps}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Disconnect Google</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Revokes Routely&rsquo;s access and stops every website&rsquo;s sync. Your spreadsheets
            and every row already in them are left untouched.
          </p>
        </div>
        <div className="flex gap-2">
          <ConnectGoogleButton label="Reconnect" variant="outline" />
          <DisconnectDialog action={disconnectSheetsAction} googleEmail={connection.googleEmail} />
        </div>
      </div>
    </div>
  );
}

/**
 * One run's outcome in a sentence.
 *
 * `UNKNOWN` gets the longest treatment on purpose: it is the one state where Routely genuinely does
 * not know what happened, and saying so — with what to check — is better than a reassuring label
 * that might be wrong.
 */
function RunSummary({ run }: { run: NonNullable<WebsiteSheetSummary["lastRun"]> }) {
  if (run.status === "SUCCEEDED") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CheckCircle2 className="size-3.5" aria-hidden />
        {run.rowsWritten === 0
          ? "nothing to write"
          : `${run.rowsWritten} ${run.rowsWritten === 1 ? "row" : "rows"} written`}
      </span>
    );
  }

  if (run.status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Clock className="size-3.5" aria-hidden />
        in progress
      </span>
    );
  }

  if (run.status === "UNKNOWN") {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-500">
        <HelpCircle className="size-3.5" aria-hidden />
        interrupted — check the spreadsheet
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-destructive">
      <XCircle className="size-3.5" aria-hidden />
      {run.error ?? "failed"}
    </span>
  );
}

/** Turns the callback route's redirect codes into something a customer can read. */
function readFlash(
  params: Record<string, string | string[] | undefined>,
): { tone: "success" | "error"; title: string; body: string } | null {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  if (first("connected")) {
    return {
      tone: "success",
      title: "Google connected",
      body: "Now attach a spreadsheet to each website you want synced.",
    };
  }

  const error = first("error");
  if (!error) return null;

  const messages: Record<string, { title: string; body: string }> = {
    denied: {
      title: "Connection cancelled",
      body: "You cancelled on Google's screen, so nothing was connected.",
    },
    state: {
      title: "That connection attempt expired",
      body: "For your security the request is only valid for a few minutes. Please try again.",
    },
    invalid: {
      title: "Google's response was incomplete",
      body: "Please try connecting again.",
    },
    google: {
      title: "Google refused the request",
      body: "Please try again. If it keeps happening, check that this Google account has access to Google Sheets.",
    },
    not_configured: {
      title: "This integration is not configured",
      body: "Google OAuth credentials are missing on this deployment.",
    },
    connect: {
      title: "Could not finish connecting",
      body: first("detail") ?? "Please try again.",
    },
  };

  const message = messages[error] ?? { title: "Could not connect", body: "Please try again." };

  return { tone: "error", ...message };
}
