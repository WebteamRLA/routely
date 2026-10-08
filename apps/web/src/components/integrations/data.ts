import "server-only";

import type { SheetsPanelData } from "@/components/integrations/types";
import { env } from "@/env";
import { buildDatedSheetRows, SHEET_COLUMNS } from "@/lib/sheet-rows";
import { utcDayKey, utcDayRange, utcDaysEndingWith } from "@/lib/utc-day";
import { getArmRowsByDay } from "@/server/services/analytics.service";
import { getIntegrationOverview, WINDOW_DAYS } from "@/server/services/sheets-sync.service";

const PREVIEW_ROWS = 8;

/**
 * The Sheets panel for one project, composed from the existing integration read model (which
 * makes no Google API calls) plus the same per-arm rows the refresh writes.
 */
export async function getSheetsPanel(
  actorUserId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<SheetsPanelData> {
  const today = utcDayKey(now);
  const from = utcDayRange(utcDaysEndingWith(today, WINDOW_DAYS)[0] as string).from;
  const [overview, armRows] = await Promise.all([
    getIntegrationOverview(actorUserId),
    getArmRowsByDay(actorUserId, { from, to: utcDayRange(today).to }, projectId),
  ]);

  const website = overview.websites.find((w) => w.websiteId === projectId);
  const destination = website?.destination ?? null;

  // The latest day that has any rows — "yesterday's rows" in the design, real data here.
  const lastDay = armRows.at(-1)?.day;
  const latest = lastDay ? armRows.filter((r) => r.day === lastDay).slice(0, PREVIEW_ROWS) : [];

  return {
    configured: overview.configured,
    configurationHint: overview.configurationHint,
    connection: overview.connection
      ? {
          googleEmail: overview.connection.googleEmail,
          connectedAt: overview.connection.connectedAt.toISOString(),
          needsReconnect: overview.connection.status === "NEEDS_RECONNECT",
          statusDetail: overview.connection.statusDetail,
          canUseSheets: overview.connection.canUseSheets,
        }
      : null,
    destination: destination
      ? {
          spreadsheetId: destination.spreadsheetId,
          spreadsheetName: destination.spreadsheetName,
          sheetTitle: destination.sheetTitle,
          refreshedAt: destination.refreshedAt?.toISOString() ?? null,
          rowCount: destination.rowCount,
          lastError: destination.lastError,
        }
      : null,
    columns: [...SHEET_COLUMNS],
    rows: buildDatedSheetRows(latest),
    pickerKey: env.NEXT_PUBLIC_GOOGLE_API_KEY ?? null,
    projectNumber: env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? null,
  };
}
