"use client";

import { useActionState, useState } from "react";
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

  const meta = [
    destination.rowCount > 0
      ? `${destination.rowCount} ${destination.rowCount === 1 ? "row" : "rows"}`
      : null,
    destination.refreshedAt ? `updated ${formatDateTime(destination.refreshedAt)} UTC` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      {/* Plain text, not a link: "View spreadsheet" sits in the status column beside this, and two
       * links to the same file a few pixels apart is a choice nobody wants to make. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">
          {destination.spreadsheetName ?? destination.spreadsheetId}
        </span>
        <span className="text-xs text-muted-foreground">
          {destination.sheetTitle} tab{meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
        </span>
      </div>

      {destination.lastError ? (
        <p className="text-xs text-destructive">{destination.lastError}</p>
      ) : null}

      {/* Two websites on one tab overwrite each other on every refresh — silently, and impossible to
       * diagnose from the spreadsheet, where the numbers simply flicker between sites. */}
      {sharedWith && sharedWith.length > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          Also written to by {sharedWith.join(" and ")} — they will overwrite each other. Give each
          website its own spreadsheet.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {canSync ? <RefreshSheetButton action={refreshSheetAction} websiteId={websiteId} /> : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setChanging((open) => !open)}
        >
          {changing ? "Cancel" : "Change"}
        </Button>

        <form action={detachFormAction}>
          <input type="hidden" name="websiteId" value={websiteId} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
          >
            Stop
          </Button>
        </form>
      </div>

      {changing ? (
        <div className="pt-1">
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
