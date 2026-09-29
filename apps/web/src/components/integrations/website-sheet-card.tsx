"use client";

import { useActionState } from "react";
import { ExternalLink, Sheet, Unplug } from "lucide-react";

import { formatDateTime } from "@/lib/format";

import { AttachSheetControls } from "@/components/integrations/attach-sheet-controls";
import { RefreshSheetButton } from "@/components/integrations/refresh-sheet-button";
import { Button } from "@/components/ui/button";
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";
import type { AttachResult, PickerTokenResult } from "@/server/actions/integration.actions";

export interface SheetDestination {
  spreadsheetId: string;
  spreadsheetName: string | null;
  sheetTitle: string;
  createdByRoutely: boolean;
  refreshedAt: Date | null;
  rowCount: number;
  lastError: string | null;
}

/**
 * One website's Google Sheets destination: what it is, how to change it, how to stop.
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
  /** False while the grant needs reconnecting — syncing would only fail. */
  canSync: boolean;
}) {
  const [detachState, detachFormAction] = useActionState(detachSheetAction, IDLE);
  useFormToast(detachState);

  if (!destination) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No spreadsheet yet. Choose one of yours, or let Routely create one. It then keeps the last
          30 days of results up to date, within seconds of a visit or a conversion.
        </p>
        <AttachSheetControls
          websiteId={websiteId}
          developerKey={developerKey}
          projectNumber={projectNumber}
          getPickerToken={getPickerToken}
          attachSheet={attachSheet}
          createSheetAction={createSheetAction}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">
              {destination.spreadsheetName ?? destination.spreadsheetId}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Writing to the <span className="font-medium">{destination.sheetTitle}</span> tab
            {destination.createdByRoutely ? " · spreadsheet created by Routely" : ""}
          </p>
          {destination.lastError ? (
            <p className="text-xs text-destructive">{destination.lastError}</p>
          ) : destination.refreshedAt ? (
            <p className="text-xs text-muted-foreground">
              Updated {formatDateTime(destination.refreshedAt)} UTC · {destination.rowCount}{" "}
              {destination.rowCount === 1 ? "row" : "rows"}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiting for the first visitor — the tab fills in within seconds of one arriving.
            </p>
          )}
        </div>

        <Button variant="ghost" size="sm" asChild>
          {/* Opens the customer's own spreadsheet. Built from the id rather than stored, so a
           * renamed or moved file still opens. */}
          <a
            href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(destination.spreadsheetId)}/edit`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Sheets
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canSync ? <RefreshSheetButton action={refreshSheetAction} websiteId={websiteId} /> : null}

        <form action={detachFormAction}>
          <input type="hidden" name="websiteId" value={websiteId} />
          <Button type="submit" variant="ghost" size="sm">
            <Unplug aria-hidden />
            Stop syncing
          </Button>
        </form>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Use a different spreadsheet
        </summary>
        <div className="pt-3">
          <AttachSheetControls
            websiteId={websiteId}
            developerKey={developerKey}
            projectNumber={projectNumber}
            getPickerToken={getPickerToken}
            attachSheet={attachSheet}
            createSheetAction={createSheetAction}
          />
          <p className="pt-2 text-xs text-muted-foreground">
            The old spreadsheet is left exactly as it is; Routely simply stops updating it.
          </p>
        </div>
      </details>
    </div>
  );
}
