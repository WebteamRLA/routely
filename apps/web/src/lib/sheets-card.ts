/**
 * The Google Sheets read model shared by the Integrations page and a project dashboard's Sheets
 * card + setup dialog, plus the copy for every state the backend can be in.
 *
 * Pure and import-free so client components can use it: the server loader
 * (`getProjectSheetsCard` / `getIntegrationsCard` in `sheets-sync.service.ts`) builds these
 * shapes, the client renders them. Dates cross the boundary as ISO strings.
 */

/** Where the start route lives. A `<form method="post">` to it begins the consent flow. */
export const GOOGLE_CONNECT_ACTION = "/api/integrations/google/start";

/** The query parameter the OAuth callback writes its outcome to, on the page it returns to. */
export const SHEETS_OUTCOME_PARAM = "sheets";

export const SHEETS_COPY = {
  notConfigured: "Google Sheets isn’t available yet",
  notConfiguredDetail: "An administrator needs to finish setting up the Google integration.",
  needsReconnect: "Google needs you to reconnect",
  /** The project dialog's wording. */
  signInFailed: "Google sign-in didn’t finish. Try again.",
  /** The Integrations card's shorter wording for the same outcome. */
  catalogSignInFailed: "Sign-in didn’t finish. Try again.",
  /**
   * The scheduled refresh runs at 00:20 UTC (`vercel.json`: `20 0 * * *`), so the copy says
   * "shortly after midnight" rather than the design's "00:00": one of the two had to move, and the
   * schedule is shared with the platform's cron configuration.
   */
  refreshSchedule:
    "Updates within seconds of new visits and conversions, plus a full refresh every day shortly after midnight UTC.",
  onlyConnectorCanPick: (email: string) =>
    `Only ${email} can browse their Google Drive. Create a new Google Sheet instead, or ask them to pick one.`,
  adminOnly: "Only an Owner or Admin can change the Google Sheets setup.",
} as const;

export function lastErrorCopy(error: string): string {
  return `Last sync failed: ${error}`;
}

export interface SheetsAccount {
  email: string | null;
  name: string | null;
  picture: string | null;
  /** Two letters for the avatar, from the name or else the email. */
  initials: string;
  status: "CONNECTED" | "NEEDS_RECONNECT";
  statusDetail: string | null;
  /** False when the customer unticked the Drive permission on Google's consent screen. */
  canUseSheets: boolean;
  /** True when the viewer is the member who connected it — the only one who may open the Picker. */
  isConnector: boolean;
}

export interface SheetsDestination {
  spreadsheetId: string;
  spreadsheetName: string | null;
  sheetId: number;
  sheetTitle: string;
  /** `https://docs.google.com/spreadsheets/d/{id}/edit#gid={sheetId}` */
  url: string;
  /** ISO time of the last successful write, or null before the first one. */
  refreshedAt: string | null;
  rowCount: number;
  lastError: string | null;
}

export type SheetsOutcome =
  { kind: "connected" } | { kind: "error"; reason: SheetsOutcomeReason; message: string };

export type SheetsOutcomeReason =
  | "denied"
  | "state"
  | "invalid"
  | "google"
  | "scope"
  | "refresh"
  | "connect"
  | "forbidden"
  | "not_configured";

const OUTCOME_MESSAGES: Record<SheetsOutcomeReason, string> = {
  denied: SHEETS_COPY.signInFailed,
  state: SHEETS_COPY.signInFailed,
  invalid: SHEETS_COPY.signInFailed,
  google: SHEETS_COPY.signInFailed,
  connect: SHEETS_COPY.signInFailed,
  scope:
    "Routely needs permission to create and edit the Google Sheets you choose. Connect again and leave that permission ticked.",
  refresh:
    "Google didn’t grant lasting access. Remove Routely at myaccount.google.com/permissions, then connect again.",
  forbidden: "Only an Owner or Admin can connect Google.",
  not_configured: `${SHEETS_COPY.notConfigured}.`,
};

/**
 * Reads the callback's outcome from a page's search params.
 *
 * Only fixed codes travel in the URL, never free text: a message read from the query string would
 * let anyone craft a link that shows our page saying whatever they like.
 */
export function readSheetsOutcome(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): SheetsOutcome | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const value = first(searchParams?.[SHEETS_OUTCOME_PARAM]);

  if (value === "connected") return { kind: "connected" };
  if (value !== "error") return null;

  const raw = first(searchParams?.reason);
  const reason: SheetsOutcomeReason =
    raw && raw in OUTCOME_MESSAGES ? (raw as SheetsOutcomeReason) : "connect";
  return { kind: "error", reason, message: OUTCOME_MESSAGES[reason] };
}

/** The query string the callback appends to `returnTo`. */
export function outcomeQuery(outcome: "connected" | SheetsOutcomeReason): string {
  return outcome === "connected"
    ? `${SHEETS_OUTCOME_PARAM}=connected`
    : `${SHEETS_OUTCOME_PARAM}=error&reason=${outcome}`;
}

export interface SheetsPermissions {
  /** Connect, attach, create, change, detach (Owner/Admin). */
  manage: boolean;
  /** "Sync now" (Owner/Admin/Editor). */
  sync: boolean;
  /** Open the Google Picker: manage *and* being the connector. */
  pick: boolean;
}

/** Everything a project dashboard's Sheets card and setup dialog render. */
export interface ProjectSheetsCard {
  websiteId: string;
  projectName: string;
  /** False when the Google client or TOKEN_ENCRYPTION_KEY is missing. */
  configured: boolean;
  account: SheetsAccount | null;
  destination: SheetsDestination | null;
  permissions: SheetsPermissions;
  /** Browser-side Picker configuration, or null when the Picker cannot be offered. */
  picker: { apiKey: string; projectNumber: string } | null;
  /** The OAuth callback's outcome when the page was reached from it, else null. */
  outcome: SheetsOutcome | null;
}

/** The Integrations page's Google Sheets card. */
export interface IntegrationsSheetsCard {
  configured: boolean;
  workspaceName: string;
  account: SheetsAccount | null;
  /** Projects whose last write failed, for the "Sync stopped" state. */
  failing: { websiteId: string; projectName: string; lastError: string }[];
  permissions: Pick<SheetsPermissions, "manage">;
  outcome: SheetsOutcome | null;
}

export type SheetsCardStatus =
  "not_configured" | "none" | "needs_reconnect" | "sync_stopped" | "connected";

/** One status for a card, most urgent first. */
export function sheetsStatus(input: {
  configured: boolean;
  account: SheetsAccount | null;
  failing: boolean;
}): SheetsCardStatus {
  if (!input.configured) return "not_configured";
  if (!input.account) return "none";
  if (input.account.status === "NEEDS_RECONNECT" || !input.account.canUseSheets) {
    return "needs_reconnect";
  }
  return input.failing ? "sync_stopped" : "connected";
}

export function spreadsheetUrl(spreadsheetId: string, sheetId: number): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit#gid=${sheetId}`;
}

/** "Alex Morgan" → "AM"; "alex@fernwood.com" → "AL"; nothing → "G". */
export function initialsFor(name: string | null, email: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  const local = (email ?? "").split("@")[0]?.replace(/[^A-Za-z0-9]/g, "") ?? "";
  return local ? local.slice(0, 2).toUpperCase() : "G";
}

/** Who the account is, for copy: the email when known, else a neutral phrase. */
export function accountLabel(account: Pick<SheetsAccount, "email"> | null): string {
  return account?.email ?? "the connected Google account";
}

/** Default name offered in the create form. */
export function defaultSpreadsheetName(projectName: string): string {
  return `Routely results — ${projectName}`;
}
