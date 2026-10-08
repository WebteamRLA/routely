import type { ReactNode } from "react";
import Link from "next/link";

import { ConnectGoogleButton } from "@/components/integrations/connect-google-button";
import { DisconnectDialog } from "@/components/integrations/disconnect-dialog";
import { SheetStatusColumn } from "@/components/integrations/sheet-status";
import { WebsiteSheetCard } from "@/components/integrations/website-sheet-card";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { SHEET_COLUMNS } from "@/lib/sheet-rows";
import { cn } from "@/lib/utils";
import {
  attachPickedSheetAction,
  createSheetAction,
  detachSheetAction,
  disconnectSheetsAction,
  getPickerTokenAction,
  refreshSheetAction,
} from "@/server/actions/integration.actions";
import type { IntegrationOverview } from "@/server/services/sheets-sync.service";

/**
 * The Google Sheets panel: one Google connection at the top, then one spreadsheet per website
 * below it.
 *
 * The customer authorises Google once; each website then points at its own sheet, which is what an
 * agency running several sites needs, and attaching one needs no further consent screen. Every
 * state shown here is derived from the read model, which makes no Google API calls — so the panel,
 * and in particular Disconnect, still works when Google is unreachable or the grant was revoked.
 */
export function SheetsPanel({ overview }: { overview: IntegrationOverview }) {
  const connection = overview.connection;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 font-heading text-[15.5px] font-bold tracking-[-0.01em]">
            Google Sheets
          </h2>
          <p className="mt-1 max-w-[560px] text-[13px] text-ink-3">
            Routely keeps a spreadsheet up to date with the last 30 days of results — one per
            website, refreshed within seconds of a visit or a conversion.
          </p>
        </div>
        {connection ? (
          connection.status === "CONNECTED" ? (
            <Pill tone="success">Connected</Pill>
          ) : (
            <Pill tone="danger">Needs reconnecting</Pill>
          )
        ) : null}
      </div>

      {!overview.configured ? (
        <NotConfigured hint={overview.configurationHint} />
      ) : !connection ? (
        <NotConnected />
      ) : (
        <Connected overview={overview} />
      )}
    </section>
  );
}

function Pill({ tone, children }: { tone: "success" | "danger"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold",
        tone === "success" ? "bg-success-bg text-success-text" : "bg-danger-bg text-danger-text",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-[7px] rounded-full",
          tone === "success" ? "bg-success" : "bg-destructive",
        )}
      />
      {children}
    </span>
  );
}

/** A full-width problem notice, with its fix beside it. */
function DangerBanner({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-bg-2 px-4 py-3.5"
    >
      <div className="min-w-0 flex-1 basis-[260px]">
        <p className="font-extrabold text-danger-text">{title}</p>
        <p className="mt-0.5 text-[13px] text-[#7A2E1D]">{children}</p>
      </div>
      {action}
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
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-[#CBD1DC] p-6">
      <p className="font-extrabold">This integration is not configured</p>
      <p className="text-[13px] text-ink-3">
        Set{" "}
        {hint ? (
          <code className="font-mono text-[12.5px] text-foreground">{hint}</code>
        ) : (
          "the required environment variables"
        )}{" "}
        to enable it. Routely will not store a Google refresh token without an encryption key for
        it.
      </p>
    </div>
  );
}

/** What the tab looks like. Illustrative rows, labelled as such — nothing here is the customer's. */
function RowsPreview() {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[620px] text-[12.5px]">
        <thead className="bg-[#F5F6F9]">
          <tr>
            {SHEET_COLUMNS.map((column) => (
              <th
                key={column}
                className="px-3 py-2 text-left font-mono text-[11.5px] font-extrabold whitespace-nowrap text-ink-2"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {[
            ["2026-09-28", "Pricing redesign", "Control", "412", "30", "7.3"],
            ["2026-09-28", "Pricing redesign", "Variant 1", "408", "41", "10.0"],
          ].map((row) => (
            <tr key={row[2]} className="border-t border-divider">
              {row.map((cell, index) => (
                <td key={index} className="px-3 py-2 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotConnected() {
  return (
    <>
      <div className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-[#CBD1DC] p-5 sm:p-6">
        <p className="font-extrabold">Not connected</p>
        <p className="max-w-[640px] text-[13px] text-ink-3">
          You&rsquo;ll sign in with Google once. Routely can then see only the spreadsheets you pick
          and the ones it creates for you. It cannot list, open or read anything else in your Google
          Drive — you choose files in Google&rsquo;s own picker, and Google grants access to just
          that file.
        </p>
        <ConnectGoogleButton variant="dark" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-extrabold">Example of the rows Routely writes</p>
        <p className="text-[13px] text-ink-3">
          One row per experiment arm per day, for the last 30 days, in a tab Routely keeps current:
        </p>
        <RowsPreview />
        <p className="text-[12.5px] text-ink-3">
          Days run to UTC midnight, the same boundary every date in Routely uses. Routely creates
          and maintains its own tab inside the spreadsheet you choose; nothing else in that file is
          touched.
        </p>
      </div>
    </>
  );
}

function Connected({ overview }: { overview: IntegrationOverview }) {
  const connection = overview.connection;
  if (!connection) return null;

  const attached = overview.websites.filter((website) => website.destination !== null);
  const canSync = connection.status === "CONNECTED" && connection.canUseSheets;

  /*
   * Two websites pointing at one spreadsheet tab overwrite each other on every refresh — silently,
   * repeatedly, and undiagnosably from the spreadsheet itself, where the numbers simply flicker
   * between two sites. Cheap to detect here, so it is surfaced rather than left to be discovered.
   */
  const websitesBySheet = new Map<string, string[]>();
  for (const website of attached) {
    const key = `${website.destination?.spreadsheetId}::${website.destination?.sheetTitle}`;
    websitesBySheet.set(key, [...(websitesBySheet.get(key) ?? []), website.websiteName]);
  }

  const sharedWith = (website: (typeof overview.websites)[number]): string[] => {
    if (!website.destination) return [];
    const key = `${website.destination.spreadsheetId}::${website.destination.sheetTitle}`;
    return (websitesBySheet.get(key) ?? []).filter((name) => name !== website.websiteName);
  };

  const sheetProps = {
    developerKey: env.NEXT_PUBLIC_GOOGLE_API_KEY,
    projectNumber: env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
    getPickerToken: getPickerTokenAction,
    attachSheet: attachPickedSheetAction,
    createSheetAction,
    detachSheetAction,
    refreshSheetAction,
    canSync,
  };

  return (
    <>
      {connection.status === "NEEDS_RECONNECT" ? (
        <DangerBanner
          title="Google access has stopped working"
          action={<ConnectGoogleButton label="Reconnect" variant="destructive-outline" />}
        >
          {connection.statusDetail ?? "Reconnect your Google account to resume the daily sync."} The
          daily sync is paused until you reconnect. Every website keeps its spreadsheet and its
          history.
        </DangerBanner>
      ) : null}

      {connection.status === "CONNECTED" && !connection.canUseSheets ? (
        <DangerBanner
          title="A required permission was declined"
          action={<ConnectGoogleButton label="Reconnect" variant="destructive-outline" />}
        >
          Routely was not given permission to create and edit the Google Sheets you choose.
          Reconnect and leave that permission ticked.
        </DangerBanner>
      ) : null}

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
        <Tile label="Google account">{connection.googleEmail ?? "Connected"}</Tile>
        <Tile label="Connected">{formatDateTime(connection.connectedAt)} UTC</Tile>
        <Tile label="Websites publishing">
          <span className="tabular-nums">{attached.length}</span>
          <span className="font-semibold text-ink-3"> of {overview.websites.length}</span>
        </Tile>
      </dl>

      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-[13px] font-extrabold">Spreadsheet per website</h3>
          <p className="mt-0.5 text-[13px] text-ink-3">
            Each website has its own spreadsheet. A website with none attached is simply not
            published.
          </p>
        </div>

        {overview.websites.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[#CBD1DC] p-6 text-center">
            <p className="text-[13px] text-ink-3">
              You have no websites yet. Add one and you can attach a spreadsheet to it.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={routes.getStarted}>Get started</Link>
            </Button>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border">
            {overview.websites.map((website) => (
              <li
                key={website.websiteId}
                className="flex flex-col gap-3 border-b border-divider p-4 last:border-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={routes.websites.detail(website.websiteId)}
                    className="min-w-0 truncate text-[13.5px] font-extrabold hover:text-primary"
                  >
                    {website.websiteName}
                  </Link>
                  <SheetStatusColumn destination={website.destination} />
                </div>

                <WebsiteSheetCard
                  websiteId={website.websiteId}
                  destination={website.destination}
                  sharedWith={sharedWith(website)}
                  {...sheetProps}
                />
              </li>
            ))}
          </ul>
        )}

        <p className="text-[12.5px] text-ink-3">
          Columns: <span className="font-mono text-xs text-ink-2">{SHEET_COLUMNS.join(" · ")}</span>
          . Days run to UTC midnight.
        </p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 border-t border-divider pt-4">
        <div className="min-w-0 flex-1 basis-[260px]">
          <h3 className="text-[13px] font-extrabold">Disconnect Google</h3>
          <p className="mt-0.5 max-w-md text-[13px] text-ink-3">
            Revokes Routely&rsquo;s access and stops every website&rsquo;s sync. Your spreadsheets
            and every row already in them are left untouched.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConnectGoogleButton label="Reconnect" variant="outline" />
          <DisconnectDialog action={disconnectSheetsAction} googleEmail={connection.googleEmail} />
        </div>
      </div>
    </>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-divider p-3">
      <dt className="text-xs font-bold text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] font-extrabold">{children}</dd>
    </div>
  );
}
