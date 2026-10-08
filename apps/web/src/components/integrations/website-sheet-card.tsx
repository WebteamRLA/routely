"use client";

import { useActionState, useState, type ReactNode } from "react";
import { AttachSheetControls } from "@/components/integrations/attach-sheet-controls";
import { RefreshSheetButton } from "@/components/integrations/refresh-sheet-button";
import { Button } from "@/components/ui/button";
import { useFormToast } from "@/hooks/use-form-toast";
import { type SheetDestination } from "@/components/integrations/sheet-status";
import { formatDateTime } from "@/lib/format";
import { IDLE, type FormState } from "@/lib/form-state";
import type { AttachResult, PickerTokenResult } from "@/server/actions/integration.actions";

export type { SheetDestination };

/**
 * One website's Google Sheets destination: what it is, and what you can do with it.
 *
 * Shared by the website's own page and the integrations page, so the two can never describe the same
 * state differently.
 */
export function WebsiteSheetCard({
  websiteId,
  destination,
  developerKey,
  projectNumber,
  getPickerToken,
  attachSheet,
  createSheetAction,
  detachSheetAction,
  refreshSheetAction,
  canSync,
  sharedWith,
}: {
  websiteId: string;
  destination: SheetDestination | null;
  developerKey?: string;
  projectNumber?: string;
  getPickerToken: () => Promise<PickerTokenResult>;
  attachSheet: (input: { websiteId: string; spreadsheetId: string }) => Promise<AttachResult>;
  createSheetAction: (state: FormState, formData: FormData) => Promise<FormState>;
  detachSheetAction: (state: FormState, formData: FormData) => Promise<FormState>;
  refreshSheetAction: (state: FormState, formData: FormData) => Promise<FormState>;
  /** False while the grant needs reconnecting — refreshing would only fail. */
  canSync: boolean;
  /** Other websites writing to this same tab, which would overwrite each other. */
  sharedWith?: string[];
}) {
  const [detachState, detachFormAction] = useActionState(detachSheetAction, IDLE);
  useFormToast(detachState);
  const [changing, setChanging] = useState(false);

  if (!destination) {
    return (
      <AttachSheetControls
        websiteId={websiteId}
        developerKey={developerKey}
        projectNumber={projectNumber}
        getPickerToken={getPickerToken}
        attachSheet={attachSheet}
        createSheetAction={createSheetAction}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
        {/* Plain text, not a link: "View spreadsheet" sits in the status column beside this, and
         * two links to the same file a few pixels apart is a choice nobody wants to make. */}
        <Tile label="Destination">
          <span className="break-words">
            {destination.spreadsheetName ?? destination.spreadsheetId} › {destination.sheetTitle}
          </span>
        </Tile>
        <Tile
          label="Last refreshed"
          sub={
            destination.refreshedAt
              ? `${destination.rowCount} ${destination.rowCount === 1 ? "row" : "rows"}`
              : undefined
          }
        >
          {destination.refreshedAt ? `${formatDateTime(destination.refreshedAt)} UTC` : "Not yet"}
        </Tile>
        <Tile label="Next refresh" sub="The last 30 days are rewritten each time">
          {canSync ? "With the next visit or conversion, and daily" : "Paused until you reconnect"}
        </Tile>
      </div>

      {destination.lastError ? (
        <div className="rounded-lg border border-danger-border bg-danger-bg-2 px-4 py-3">
          <p className="text-[13.5px] font-extrabold text-danger-text">Last refresh failed</p>
          <p className="mt-0.5 text-[13px] text-danger-text/90">{destination.lastError}</p>
        </div>
      ) : null}

      {/* Two websites on one tab overwrite each other on every refresh — silently, and impossible to
       * diagnose from the spreadsheet, where the numbers simply flicker between sites. */}
      {sharedWith && sharedWith.length > 0 ? (
        <p className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-warning-text">
          Also written to by {sharedWith.join(" and ")} — they will overwrite each other. Give each
          website its own spreadsheet.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canSync ? <RefreshSheetButton action={refreshSheetAction} websiteId={websiteId} /> : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setChanging((open) => !open)}
        >
          {changing ? "Cancel" : "Change spreadsheet"}
        </Button>

        <form action={detachFormAction}>
          <input type="hidden" name="websiteId" value={websiteId} />
          <Button type="submit" variant="destructive-outline" size="sm">
            Stop syncing
          </Button>
        </form>
      </div>

      {changing ? (
        <div className="rounded-lg border border-divider bg-subtle p-4">
          <AttachSheetControls
            websiteId={websiteId}
            developerKey={developerKey}
            projectNumber={projectNumber}
            getPickerToken={getPickerToken}
            attachSheet={attachSheet}
            createSheetAction={createSheetAction}
          />
        </div>
      ) : null}
    </div>
  );
}

function Tile({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-divider p-3">
      <div className="text-xs font-bold text-ink-3">{label}</div>
      <div className="mt-0.5 text-[13.5px] font-extrabold">{children}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-3">{sub}</div> : null}
    </div>
  );
}
