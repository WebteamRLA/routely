/** Plain, serialisable data for the project's Sheets panel. */
export interface SheetsPanelData {
  /** False when TOKEN_ENCRYPTION_KEY or the Google client is missing on this deployment. */
  configured: boolean;
  configurationHint: string | null;
  connection: null | {
    googleEmail: string | null;
    connectedAt: string;
    needsReconnect: boolean;
    statusDetail: string | null;
    /** False when the Drive permission was unticked on Google's consent screen. */
    canUseSheets: boolean;
  };
  /** This project's spreadsheet, or null when none is attached. */
  destination: null | {
    spreadsheetId: string;
    spreadsheetName: string | null;
    sheetTitle: string;
    refreshedAt: string | null;
    rowCount: number;
    lastError: string | null;
  };
  /** Header + the most recent day's real rows for this project (what the tab holds), max 8. */
  columns: string[];
  rows: (string | number)[][];
  /** Google Picker configuration (public values). */
  pickerKey: string | null;
  projectNumber: string | null;
}
