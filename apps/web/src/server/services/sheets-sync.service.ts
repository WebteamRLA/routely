import "server-only";

import { z } from "zod";

import { env } from "@/env";
import { buildSheetSections } from "@/lib/sheet-rows";
import {
  type IntegrationsSheetsCard,
  type ProjectSheetsCard,
  type SheetsAccount,
  type SheetsDestination,
  initialsFor,
  readSheetsOutcome,
  spreadsheetUrl,
} from "@/lib/sheets-card";
import { utcDayKey, utcDayRange, utcDaysEndingWith } from "@/lib/utc-day";
import {
  SECRET_PURPOSES,
  decryptSecret,
  encryptSecret,
  isSecretStorageConfigured,
} from "@/server/crypto";
import { type Capability, can, rolesWith } from "@/lib/permissions";
import { findRole } from "@/server/auth/workspace";
import { AppError, conflict, forbidden, isAppError, notFound } from "@/server/errors";
import * as connectionRepo from "@/server/repositories/sheets-connection.repository";
import * as targetRepo from "@/server/repositories/website-sheet-target.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { getWebsiteArmRowsByDay } from "@/server/services/analytics.service";
import { notify } from "@/server/services/notification.service";
import * as googleOAuth from "@/server/services/google-oauth.service";
import * as sheets from "@/server/services/google-sheets.service";
import { parseOrThrow } from "@/server/validate";
import { sheetTargetSchema, spreadsheetNameSchema } from "@/validation/integration";

import type { SheetsConnection } from "@/generated/prisma/client";

/**
 * The Google Sheets daily sync.
 *
 * ## Grant and destination are separate things
 *
 * The customer authorises Google **once per workspace** (`SheetsConnection`). Each of its
 * **websites** then points at its own spreadsheet (`WebsiteSheetTarget`). That split is what makes
 * the flow bearable: attaching a sheet to a website needs no consent screen, because the grant
 * already exists — and Google caps refresh tokens at roughly 100 per account per OAuth client,
 * silently invalidating the oldest, which a grant-per-website design would eventually hit.
 *
 * Attaching a sheet is **optional**. A website with no target is simply not synced, so adding a
 * website never depends on Google being reachable and a customer who does not want Sheets is never
 * blocked by it.
 *
 * ## One tab, rewritten from source
 *
 * Each website's spreadsheet holds a single tab that Routely owns, showing a rolling window of
 * recent days. Every refresh recomputes that window from the database and overwrites the tab.
 *
 * That is what makes the spreadsheet incapable of disagreeing with the dashboard: there is no
 * accumulated state to drift, and no notion of a day being "already written". It also makes a
 * refresh idempotent by construction — running it twice leaves the same cells — which is why the
 * per-day claim rows the append-based design needed are gone.
 *
 * The customer chooses a *spreadsheet*, not a tab. A full overwrite aimed at a tab holding their own
 * work would destroy it, so Routely creates and owns the tab it writes.
 */

/** Wall-clock budget for one sweep, leaving room under the platform's function timeout. */
const SWEEP_BUDGET_MS = 45_000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Names the first missing piece of configuration, or null when everything is present. */
function missingConfiguration(): string | null {
  if (!googleOAuth.isGoogleOAuthConfigured()) {
    return "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET";
  }

  if (!isSecretStorageConfigured()) return "TOKEN_ENCRYPTION_KEY";

  return null;
}

/** The integration can be used on this deployment (the Dashboard checklist's Sheets step). */
export function isSheetsAvailable(): boolean {
  return missingConfiguration() === null;
}

function assertConfigured(): void {
  const missing = missingConfiguration();

  if (missing) {
    throw new AppError("INTERNAL", `The Google Sheets integration is not configured: ${missing}.`);
  }
}

// ---------------------------------------------------------------------------
// Read model for the integrations page
// ---------------------------------------------------------------------------

export interface SheetDestinationSummary {
  spreadsheetId: string;
  spreadsheetName: string | null;
  sheetTitle: string;
  createdByRoutely: boolean;
  /** When the tab was last written. Null until the first refresh. */
  refreshedAt: Date | null;
  /** Rows currently on the tab, excluding the header. */
  rowCount: number;
  /** Why the last refresh failed, or null when it succeeded. */
  lastError: string | null;
}

export interface WebsiteSheetSummary {
  websiteId: string;
  websiteName: string;
  destination: SheetDestinationSummary | null;
}

export interface IntegrationOverview {
  /** False when TOKEN_ENCRYPTION_KEY or the Google client is missing. */
  configured: boolean;
  /** Which variable is missing, for an operator reading the page. Null when configured. */
  configurationHint: string | null;
  connection: null | {
    googleEmail: string | null;
    connectedAt: Date;
    status: SheetsConnection["status"];
    statusDetail: string | null;
    /** False when the customer unticked the Drive permission on Google's consent screen. */
    canUseSheets: boolean;
  };
  /** Every website the actor owns, each with its destination and latest run. */
  websites: WebsiteSheetSummary[];
}

/**
 * Everything the integrations page renders.
 *
 * **Makes no Google API calls.** The page has to render — and in particular has to keep offering
 * Disconnect — when Google is unreachable or the grant has been revoked. Reaching out to Google here
 * would make an outage at Google look like an outage in Routely, and would leave a customer unable
 * to disconnect a connection that no longer works.
 */
export async function getIntegrationOverview(
  actorUserId: string,
  workspaceId: string,
): Promise<IntegrationOverview> {
  const configurationHint = missingConfiguration();

  const [connection, websites, targets] = await Promise.all([
    connectionRepo.findConnectionForWorkspace(workspaceId, actorUserId),
    websiteRepo.listWebsitesInWorkspace(workspaceId, actorUserId),
    targetRepo.listTargetsInWorkspace(workspaceId, actorUserId),
  ]);

  const targetByWebsite = new Map(targets.map((target) => [target.websiteId, target]));

  return {
    configured: configurationHint === null,
    configurationHint,
    connection: connection
      ? {
          googleEmail: connection.googleEmail,
          connectedAt: connection.connectedAt,
          status: connection.status,
          statusDetail: connection.statusDetail,
          canUseSheets: googleOAuth.canUseSheets(connection.grantedScopes),
        }
      : null,
    websites: websites.map((website) => ({
      websiteId: website.id,
      websiteName: website.name,
      destination: toDestinationSummary(targetByWebsite.get(website.id)),
    })),
  };
}

function toDestinationSummary(
  target: targetRepo.TargetWithWebsite | undefined,
): SheetDestinationSummary | null {
  if (!target) return null;

  return {
    spreadsheetId: target.spreadsheetId,
    spreadsheetName: target.spreadsheetName,
    sheetTitle: target.sheetTitle,
    createdByRoutely: target.createdByRoutely,
    refreshedAt: target.refreshedAt,
    rowCount: target.rowCount,
    lastError: target.lastError,
  };
}

/** A website's destination and the state of its tab, for the website's own page. */
export async function getWebsiteSheetStatus(
  actorUserId: string,
  websiteId: string,
): Promise<{
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  destination: SheetDestinationSummary | null;
}> {
  const website = await websiteRepo.findWebsiteForUser(websiteId, actorUserId);
  if (!website) throw notFound("That website does not exist.");

  const [connection, target] = await Promise.all([
    connectionRepo.findConnectionForWorkspace(website.workspaceId, actorUserId),
    targetRepo.findTargetForWebsite(websiteId, actorUserId),
  ]);

  return {
    configured: missingConfiguration() === null,
    connected: connection !== null,
    needsReconnect: connection?.status === "NEEDS_RECONNECT",
    destination: toDestinationSummary(target ?? undefined),
  };
}

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function toAccount(connection: SheetsConnection, actorUserId: string): SheetsAccount {
  return {
    email: connection.googleEmail,
    name: connection.googleName,
    picture: connection.googlePicture,
    initials: initialsFor(connection.googleName, connection.googleEmail),
    status: connection.status,
    statusDetail: connection.statusDetail,
    canUseSheets: googleOAuth.canUseSheets(connection.grantedScopes),
    isConnector: connection.connectedById === actorUserId,
  };
}

function toDestination(target: targetRepo.TargetWithWebsite): SheetsDestination {
  return {
    spreadsheetId: target.spreadsheetId,
    spreadsheetName: target.spreadsheetName,
    sheetId: target.sheetId,
    sheetTitle: target.sheetTitle,
    url: spreadsheetUrl(target.spreadsheetId, target.sheetId),
    refreshedAt: target.refreshedAt?.toISOString() ?? null,
    rowCount: target.rowCount,
    lastError: target.lastError,
  };
}

/** The Picker's browser-side configuration, or null when it cannot be offered. */
function pickerConfig(): ProjectSheetsCard["picker"] {
  const apiKey = env.NEXT_PUBLIC_GOOGLE_API_KEY;
  const projectNumber = env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER;
  return apiKey && projectNumber ? { apiKey, projectNumber } : null;
}

/**
 * Everything a project dashboard's Google Sheets card and setup dialog need, for one project.
 *
 * NOT_FOUND when the actor is not a member of the project's workspace. Viewing is open to every
 * member; `permissions` says which controls this actor may use (the server re-checks each one).
 * Pass the page's search params so the OAuth callback's outcome (`?sheets=…`) comes back with it.
 * Makes no Google calls, for the same reason as `getIntegrationOverview`.
 */
export async function getProjectSheetsCard(
  actorUserId: string,
  websiteId: string,
  searchParams?: SearchParamsRecord,
): Promise<ProjectSheetsCard> {
  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) throw notFound("That project does not exist.");

  const { website, role } = access;
  const [connection, target] = await Promise.all([
    connectionRepo.findConnectionForWorkspace(website.workspaceId, actorUserId),
    targetRepo.findTargetForWebsite(website.id, actorUserId),
  ]);

  const account = connection ? toAccount(connection, actorUserId) : null;
  const manage = can(role, "sheets.manage");

  return {
    websiteId: website.id,
    projectName: website.name,
    configured: missingConfiguration() === null,
    account,
    destination: target ? toDestination(target) : null,
    permissions: {
      manage,
      sync: can(role, "sheets.sync"),
      pick: manage && Boolean(account?.isConnector),
    },
    picker: pickerConfig(),
    outcome: readSheetsOutcome(searchParams),
  };
}

/** The Integrations page's Google Sheets card, for the actor's active workspace. */
export async function getIntegrationsCard(
  actorUserId: string,
  workspaceId: string,
  searchParams?: SearchParamsRecord,
): Promise<IntegrationsSheetsCard> {
  const role = await findRole(workspaceId, actorUserId);
  if (!role) throw notFound("That workspace does not exist.");

  const [connection, targets, workspaceName] = await Promise.all([
    connectionRepo.findConnectionForWorkspace(workspaceId, actorUserId),
    targetRepo.listTargetsInWorkspace(workspaceId, actorUserId),
    connectionRepo.findWorkspaceName(workspaceId, actorUserId),
  ]);

  return {
    configured: missingConfiguration() === null,
    workspaceName: workspaceName ?? "your workspace",
    account: connection ? toAccount(connection, actorUserId) : null,
    failing: targets.flatMap((target) =>
      target.lastError
        ? [
            {
              websiteId: target.websiteId,
              projectName: target.website.name,
              lastError: target.lastError,
            },
          ]
        : [],
    ),
    permissions: { manage: can(role, "sheets.manage") },
    outcome: readSheetsOutcome(searchParams),
  };
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/**
 * Stores the tokens from a completed consent flow.
 *
 * Upserts, so reconnecting keeps every website's destination — those live in their own table and are
 * not touched here. Nothing else needs preserving: each refresh rewrites the tab from source, so
 * there is no record of "days already written" for a reconnect to lose.
 */
export async function completeConnection(
  actorUserId: string,
  workspaceId: string,
  code: string,
): Promise<void> {
  assertConfigured();
  await requireWorkspaceRole(actorUserId, workspaceId, "sheets.manage");

  const tokens = await googleOAuth.exchangeCode(code);

  /*
   * Granular consent lets the customer untick individual permissions on Google's screen. Without the
   * Drive permission there is no integration at all, so this fails now with something they can act
   * on rather than storing a connection that would fail on every write.
   */
  if (!googleOAuth.canUseSheets(tokens.grantedScopes)) {
    throw new AppError(
      "VALIDATION",
      "Routely needs permission to create and edit the Google Sheets you choose. Connect again and leave that permission ticked.",
      { cause: "missing_scope" },
    );
  }

  await connectionRepo.upsertConnection(workspaceId, actorUserId, {
    googleName: tokens.name,
    googlePicture: tokens.picture,
    googleEmail: tokens.email,
    googleSubject: tokens.subject,
    refreshTokenCipher: encryptSecret(tokens.refreshToken, SECRET_PURPOSES.googleRefreshToken),
    accessTokenCipher: encryptSecret(tokens.accessToken, SECRET_PURPOSES.googleAccessToken),
    accessTokenExpiresAt: tokens.expiresAt,
    grantedScopes: tokens.grantedScopes,
  });
}

/**
 * Revokes at Google, then deletes the connection.
 *
 * Every website's destination is deleted with it, because a destination without a grant is a row
 * that cannot be acted on. The spreadsheets themselves are left in the customer's Drive untouched;
 * reconnecting and attaching one again simply rewrites its Routely tab from source.
 *
 * The connection row is deleted even when the revoke call fails: leaving one we can no longer use
 * would show the customer a connection that does nothing. The grant they can remove themselves at
 * myaccount.google.com/permissions; a phantom row they cannot.
 */
export async function disconnect(actorUserId: string, workspaceId: string): Promise<void> {
  await requireWorkspaceRole(actorUserId, workspaceId, "sheets.manage");
  const connection = await requireConnection(actorUserId, workspaceId);

  try {
    await googleOAuth.revokeToken(
      decryptSecret(connection.refreshTokenCipher, SECRET_PURPOSES.googleRefreshToken),
    );
  } catch {
    // An undecryptable token cannot be revoked. Proceeding is still right — see above.
  }

  const roles = rolesWith("sheets.manage");
  for (const target of await targetRepo.listTargetsInWorkspace(workspaceId, actorUserId)) {
    await targetRepo.detachTarget(target.websiteId, actorUserId, roles);
  }

  await connectionRepo.deleteConnectionForWorkspace(workspaceId, actorUserId, roles);
}

/** NOT_FOUND when the actor is not a member of `workspaceId`; FORBIDDEN when their role lacks it. */
async function requireWorkspaceRole(
  actorUserId: string,
  workspaceId: string,
  capability: Capability,
): Promise<void> {
  const role = await findRole(workspaceId, actorUserId);
  if (!role) throw notFound("That workspace does not exist.");
  if (!can(role, capability)) throw forbidden();
}

async function requireConnection(
  actorUserId: string,
  workspaceId: string,
): Promise<SheetsConnection> {
  const connection = await connectionRepo.findConnectionForWorkspace(workspaceId, actorUserId);

  // "Not found" rather than "forbidden", the same as everywhere else: an actor learns nothing about
  // what exists for anyone else.
  if (!connection) throw notFound("No Google account has been connected.");

  return connection;
}

/** A connection that is actually usable, or a message explaining what the customer must do. */
async function requireUsableConnection(
  actorUserId: string,
  workspaceId: string,
): Promise<SheetsConnection> {
  assertConfigured();

  const connection = await requireConnection(actorUserId, workspaceId);

  if (connection.status === "NEEDS_RECONNECT") {
    throw conflict(
      connection.statusDetail ??
        "Google access has expired. Reconnect your Google account to continue.",
    );
  }

  if (!googleOAuth.canUseSheets(connection.grantedScopes)) {
    throw conflict(
      "Routely was not given permission to use your Google Sheets. Reconnect and leave that permission ticked.",
    );
  }

  return connection;
}

/**
 * A short-lived access token for the Google Picker, which runs in the customer's browser.
 *
 * Handing an access token to client-side JavaScript deserves a justification rather than a shrug:
 *
 * - The token carries **only** `drive.file`, so it grants access to spreadsheets Routely created
 *   plus whatever the customer themselves picks. It cannot read the rest of their Drive.
 * - It is the customer's *own* token, delivered to the customer's *own* browser. A pure client-side
 *   OAuth flow — which is how Google's own Picker samples are written — would put the same token in
 *   the same place; routing it through the server means the refresh token never leaves the database.
 * - It is short-lived (Google issues roughly an hour) and never persisted client-side.
 *
 * The Picker cannot work any other way: `setOAuthToken` requires a real token in the page.
 */
export async function getPickerToken(actorUserId: string, workspaceId: string): Promise<string> {
  await requireWorkspaceRole(actorUserId, workspaceId, "sheets.manage");
  const connection = await requireUsableConnection(actorUserId, workspaceId);

  // The token belongs to whoever connected Google. Handing it to another member would let them
  // browse that person's Drive in the Picker.
  if (connection.connectedById !== actorUserId) {
    throw forbidden(
      "Only the person who connected Google can choose a spreadsheet. Ask them, or reconnect with your own Google account.",
    );
  }

  return googleOAuth.getAccessToken(connection);
}

/**
 * The Picker token for choosing a spreadsheet for one project: the grant of *that project's*
 * workspace, which need not be the actor's active one. Same rules as `getPickerToken`.
 */
export async function getPickerTokenForWebsite(
  actorUserId: string,
  websiteId: unknown,
): Promise<string> {
  const website = await requireWebsite(actorUserId, websiteId, "sheets.manage");
  return getPickerToken(actorUserId, website.workspaceId);
}

// ---------------------------------------------------------------------------
// Attaching a sheet to a website
// ---------------------------------------------------------------------------

/**
 * Resolves a website through the actor's memberships. "Not found" for a website in a workspace they
 * are not a member of; "forbidden" when their role there lacks `capability`.
 */
async function requireWebsite(
  actorUserId: string,
  websiteId: unknown,
  capability: Capability,
): Promise<{ id: string; name: string; workspaceId: string }> {
  const id = parseOrThrow(sheetTargetSchema.shape.websiteId, websiteId, "Choose a website.");
  const access = await websiteRepo.findWebsiteAccess(id, actorUserId);

  if (!access) throw notFound("That website does not exist.");
  if (!can(access.role, capability)) throw forbidden();

  const { website } = access;
  return { id: website.id, name: website.name, workspaceId: website.workspaceId };
}

/**
 * Attaches a spreadsheet the customer chose in the Google Picker.
 *
 * They choose a *spreadsheet*, not a tab. Routely creates and owns a tab inside it, because every
 * refresh overwrites that tab wholesale — aimed at a tab holding the customer's own work, it would
 * destroy it. Everything else in the file is left untouched, and the tab can be deleted freely: the
 * next refresh recreates it.
 *
 * The spreadsheet's name and the tab's title are read back from **Google**, never taken from the
 * form. A Server Action is a public HTTP endpoint, and the stored title is what the next write
 * targets.
 */
export async function attachPickedSheet(
  actorUserId: string,
  input: { websiteId: unknown; spreadsheetId: unknown },
): Promise<{ spreadsheetName: string; sheetTitle: string }> {
  const website = await requireWebsite(actorUserId, input.websiteId, "sheets.manage");
  const connection = await requireUsableConnection(actorUserId, website.workspaceId);
  const { spreadsheetId } = parseOrThrow(
    sheetTargetSchema.pick({ spreadsheetId: true }),
    { spreadsheetId: input.spreadsheetId },
    "Check the spreadsheet you chose.",
  );

  const metadata = await withAccessToken(connection, (token) =>
    sheets.getSpreadsheetMetadata(token, spreadsheetId),
  );

  const worksheet = await withAccessToken(connection, (token) =>
    sheets.ensureWorksheet(token, spreadsheetId, SHEET_TAB_TITLE),
  );

  await targetRepo.attachTarget(website.id, {
    spreadsheetId,
    spreadsheetName: metadata.spreadsheetName,
    sheetId: worksheet.sheetId,
    sheetTitle: worksheet.title,
    createdByRoutely: false,
  });

  // Populate it immediately, so the customer sees the result of what they just did rather than an
  // empty tab and a promise.
  await refreshSheet(website.id, new Date(), { force: true });

  return { spreadsheetName: metadata.spreadsheetName, sheetTitle: worksheet.title };
}

/**
 * Creates a fresh spreadsheet for a website and attaches it.
 *
 * Named by the customer (the dialog offers "Routely results — {project}"), validated to the design's
 * 100-character rule. The file is theirs from the moment it exists — they can rename, move or share it and
 * the refresh keeps working, because Routely addresses it by id.
 */
export async function createSheetForWebsite(
  actorUserId: string,
  websiteId: unknown,
  name?: unknown,
): Promise<{ spreadsheetId: string; spreadsheetName: string; sheetTitle: string }> {
  const website = await requireWebsite(actorUserId, websiteId, "sheets.manage");

  // Absent (an older form that has no name field) means the default; present means it is validated,
  // so a blank name is an error rather than silently becoming the default.
  // Through an object so the message lands in `fieldErrors.name`, beside the form's one input.
  const { name: title } = parseOrThrow(
    z.object({ name: spreadsheetNameSchema }),
    { name: name === undefined || name === null ? `Routely results — ${website.name}` : name },
    "Check the spreadsheet name.",
  );

  const connection = await requireUsableConnection(actorUserId, website.workspaceId);

  const created = await withAccessToken(connection, (token) =>
    sheets.createSpreadsheet(token, title, SHEET_TAB_TITLE),
  );

  await targetRepo.attachTarget(website.id, {
    spreadsheetId: created.spreadsheetId,
    spreadsheetName: created.spreadsheetName,
    sheetId: created.worksheet.sheetId,
    sheetTitle: created.worksheet.title,
    createdByRoutely: true,
  });

  await refreshSheet(website.id, new Date(), { force: true });

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetName: created.spreadsheetName,
    sheetTitle: created.worksheet.title,
  };
}

/** Stops syncing a website. The spreadsheet and everything in it are left alone. */
export async function detachSheet(actorUserId: string, websiteId: unknown): Promise<void> {
  const website = await requireWebsite(actorUserId, websiteId, "sheets.manage");
  const removed = await targetRepo.detachTarget(
    website.id,
    actorUserId,
    rolesWith("sheets.manage"),
  );

  if (removed.count === 0) throw notFound("That website has no spreadsheet attached.");
}

/**
 * Runs an operation with a valid access token, refreshing once on a 401.
 *
 * The retry exists because an access token can expire between the expiry check here and the request
 * arriving at Google, and because a token can be revoked server-side while still looking fresh.
 * Passing a connection with the cached ciphertext blanked forces the refresh without a database
 * write.
 */
async function withAccessToken<T>(
  connection: SheetsConnection,
  operation: (accessToken: string) => Promise<T>,
): Promise<T> {
  const token = await googleOAuth.getAccessToken(connection);

  try {
    return await operation(token);
  } catch (error) {
    const unauthorized = isAppError(error) && error.cause === "UNAUTHORIZED";
    if (!unauthorized) throw error;

    const refreshed = await googleOAuth.getAccessToken({
      ...connection,
      accessTokenCipher: null,
      accessTokenExpiresAt: null,
    });

    try {
      return await operation(refreshed);
    } catch (retryError) {
      if (isAppError(retryError) && retryError.cause === "UNAUTHORIZED") {
        await connectionRepo.markNeedsReconnect(
          connection.id,
          "Google rejected Routely's access. Reconnect to resume the daily sync.",
        );
      }

      throw retryError;
    }
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Shortest gap between two writes of one website's tab.
 *
 * Google allows **60 write requests per minute per user**. A write per event would exceed that at
 * roughly one visitor per second, so the tab is refreshed on a trailing throttle instead: traffic
 * triggers it, and this caps how often it can actually fire. Ten seconds means at most six writes a
 * minute per website — comfortably inside the quota even with several busy websites on one Google
 * account — while still feeling immediate to someone watching the spreadsheet.
 *
 * This protects the quota, not correctness. Overwriting a fixed range is idempotent, so a refresh
 * that happens twice is merely wasteful, never wrong.
 */
export const REFRESH_INTERVAL_MS = 10_000;

/** How many days the tab shows, ending with today. */
export const WINDOW_DAYS = 30;

/** The tab Routely creates and owns inside the customer's spreadsheet. */
export const SHEET_TAB_TITLE = "Routely";

/**
 * Rewrites one website's tab with the last `WINDOW_DAYS` days, today included.
 *
 * Called from event ingestion **after the response has been sent**, and from the scheduled refresh.
 * Three properties make the first of those safe:
 *
 * 1. **It is throttled by a compare-and-set**, so however many events arrive — across however many
 *    server instances — the tab is written at most once per interval.
 * 2. **It never throws.** Ingestion is the one path that must not fail, and a spreadsheet being
 *    unreachable is not a reason to lose a customer's tracking data. Failures are recorded on the
 *    target so the UI can say so, then swallowed.
 * 3. **It only ever touches Routely's own tab.** Everything else in the customer's spreadsheet is
 *    left alone.
 */
export async function refreshSheet(
  websiteId: string,
  now: Date = new Date(),
  options: { force?: boolean } = {},
): Promise<{ refreshed: boolean; rows?: number; reason?: string }> {
  if (missingConfiguration() !== null) return { refreshed: false, reason: "not configured" };

  let claimed: targetRepo.TargetWithWebsite | null = null;

  try {
    const target = await targetRepo.claimRefresh(
      websiteId,
      options.force ? 0 : REFRESH_INTERVAL_MS,
      now,
    );

    // Either no spreadsheet is attached, or another request refreshed it moments ago. Both are
    // ordinary outcomes, not failures.
    if (!target) return { refreshed: false, reason: "throttled or no destination" };
    claimed = target;

    const connection = await connectionRepo.findConnectedGrant(target.website.workspaceId);
    if (!connection) return { refreshed: false, reason: "no usable Google grant" };

    // Inclusive of today, so a window of 30 covers today and the 29 days before it.
    const from = utcDayRange(utcDaysEndingWith(utcDayKey(now), WINDOW_DAYS)[0] as string).from;
    const rows = await getWebsiteArmRowsByDay(websiteId, {
      from,
      to: utcDayRange(utcDayKey(now)).to,
    });

    // One block per experiment, so several tests on a project read as separate tables.
    const layout = buildSheetSections(
      rows.map((row) => ({
        ...row,
        experimentCreated: row.experimentCreatedAt.toISOString().slice(0, 10),
      })),
    );

    // Resolved from the stored gid, never the stored title: a tab renamed in Sheets changes its
    // title silently, and writing to a remembered name could hit the wrong tab — which, for an
    // overwrite, would mean destroying it.
    const worksheet = await withAccessToken(connection, (token) =>
      sheets.ensureWorksheet(token, target.spreadsheetId, target.sheetTitle),
    );

    await withAccessToken(connection, (token) =>
      sheets.overwriteWorksheet(
        token,
        target.spreadsheetId,
        worksheet.sheetId,
        layout.rows,
        target.rowCount,
        layout.titleRows,
      ),
    );

    await targetRepo.recordWrite(target.id, {
      sheetId: worksheet.sheetId,
      sheetTitle: worksheet.title,
      rowCount: layout.rows.length,
    });

    return { refreshed: true, rows: layout.rows.length };
  } catch (error) {
    const message = isAppError(error) ? error.message : "The refresh failed unexpectedly.";

    // Recorded so the UI can show why the numbers are stale, then swallowed — see (2) above.
    if (claimed) {
      await targetRepo.recordError(claimed.id, message).catch(() => {});
      await announceFailure(claimed, message, now);
    }

    console.error(`[routely] sheet refresh failed for website ${websiteId}:`, message);

    return { refreshed: false, reason: "failed" };
  }
}

/**
 * Emails the workspace's Owners and Admins (SHEETS_SYNC_FAILED) — once per failure streak.
 *
 * The latch is a compare-and-set on `errorNotifiedAt` (`claimErrorNotification`), taken *before*
 * `notify` so concurrent failures send one email between them; a successful write clears it. Never
 * throws, for the same reason `refreshSheet` never does.
 */
async function announceFailure(
  target: targetRepo.TargetWithWebsite,
  message: string,
  now: Date,
): Promise<void> {
  try {
    if (!(await targetRepo.claimErrorNotification(target.id, now))) return;

    notify(
      "SHEETS_SYNC_FAILED",
      target.website.workspaceId,
      { websiteId: target.websiteId, projectName: target.website.name, error: message },
      // Only an Owner or Admin can reconnect Google or re-pick the spreadsheet.
      { minRole: "ADMIN" },
    );
  } catch (error) {
    console.error("[routely] could not announce a failing sheet sync:", error);
  }
}

/** Refreshes one website on the customer's explicit request, ignoring the throttle. */
export async function refreshSheetForUser(
  actorUserId: string,
  websiteId: unknown,
): Promise<{ rows: number }> {
  const website = await requireWebsite(actorUserId, websiteId, "sheets.sync");
  await requireUsableConnection(actorUserId, website.workspaceId);

  const target = await targetRepo.findTargetForWebsite(website.id, actorUserId);
  if (!target) throw conflict("Attach a spreadsheet to this website before refreshing it.");

  const result = await refreshSheet(website.id, new Date(), { force: true });

  if (!result.refreshed) {
    throw conflict(
      target.lastError ?? "The refresh did not complete. Please try again in a moment.",
    );
  }

  return { rows: result.rows ?? 0 };
}

export interface SweepSummary {
  websites: number;
  refreshed: number;
  skipped: number;
  failed: number;
  /** True when the wall-clock budget ran out before every website was visited. */
  truncated: boolean;
}

/**
 * Refreshes every website's tab, on a schedule.
 *
 * Traffic already keeps a busy website's tab current, so this exists for the quiet ones: without it,
 * a site with no visitors today would keep showing whatever it last showed, and the window would
 * never roll forward onto the new day.
 *
 * No `actorUserId`: this acts for every account and is reachable only from the cron route, which
 * authenticates with a shared secret. Each website's rows are scoped by its own id and written with
 * its own workspace's grant, so nothing crosses between customers or between sites.
 */
export async function refreshAllSheets(now: Date = new Date()): Promise<SweepSummary> {
  assertConfigured();

  const deadline = now.getTime() + SWEEP_BUDGET_MS;
  const targets = await targetRepo.listSyncableTargets();

  const summary: SweepSummary = {
    websites: targets.length,
    refreshed: 0,
    skipped: 0,
    failed: 0,
    truncated: false,
  };

  for (const target of targets) {
    // Checked between websites rather than mid-write, so a platform timeout cannot kill a refresh
    // half way through replacing a tab's contents.
    if (Date.now() > deadline) {
      summary.truncated = true;
      break;
    }

    const result = await refreshSheet(target.websiteId, new Date(), { force: true });

    if (result.refreshed) summary.refreshed += 1;
    else if (result.reason === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }

  return summary;
}
