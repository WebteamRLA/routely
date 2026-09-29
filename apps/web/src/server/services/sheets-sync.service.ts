import "server-only";

import { buildDatedSheetRows } from "@/lib/sheet-rows";
import { utcDayKey, utcDayRange, utcDaysEndingWith } from "@/lib/utc-day";
import {
  SECRET_PURPOSES,
  decryptSecret,
  encryptSecret,
  isSecretStorageConfigured,
} from "@/server/crypto";
import { AppError, conflict, isAppError, notFound, validationFailed } from "@/server/errors";
import * as connectionRepo from "@/server/repositories/sheets-connection.repository";
import * as targetRepo from "@/server/repositories/website-sheet-target.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { getArmRowsByDay } from "@/server/services/analytics.service";
import * as googleOAuth from "@/server/services/google-oauth.service";
import * as sheets from "@/server/services/google-sheets.service";
import { parseOrThrow } from "@/server/validate";
import { sheetTargetSchema } from "@/validation/integration";

import type { SheetsConnection } from "@/generated/prisma/client";

/**
 * The Google Sheets daily sync.
 *
 * ## Grant and destination are separate things
 *
 * The customer authorises Google **once per account** (`SheetsConnection`). Each of their
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
export async function getIntegrationOverview(actorUserId: string): Promise<IntegrationOverview> {
  const configurationHint = missingConfiguration();

  const [connection, websites, targets] = await Promise.all([
    connectionRepo.findConnectionForUser(actorUserId),
    websiteRepo.listWebsitesForUser(actorUserId),
    targetRepo.listTargetsForUser(actorUserId),
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
  const [connection, target] = await Promise.all([
    connectionRepo.findConnectionForUser(actorUserId),
    targetRepo.findTargetForWebsite(websiteId, actorUserId),
  ]);

  return {
    configured: missingConfiguration() === null,
    connected: connection !== null,
    needsReconnect: connection?.status === "NEEDS_RECONNECT",
    destination: toDestinationSummary(target ?? undefined),
  };
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/**
 * Stores the tokens from a completed consent flow.
 *
 * Upserts, so reconnecting keeps every website's destination — those live in their own table and are
 * not touched here. The run history survives too, because it is keyed on the website rather than on
 * the grant; losing it would make the next sweep re-send days already written.
 */
export async function completeConnection(actorUserId: string, code: string): Promise<void> {
  assertConfigured();

  const tokens = await googleOAuth.exchangeCode(code);

  /*
   * Granular consent lets the customer untick individual permissions on Google's screen. Without the
   * Drive permission there is no integration at all, so this fails now with something they can act
   * on rather than storing a connection that would fail on every write.
   */
  if (!googleOAuth.canUseSheets(tokens.grantedScopes)) {
    throw validationFailed(
      "Routely needs permission to create and edit the Google Sheets you choose. Connect again and leave that permission ticked.",
    );
  }

  await connectionRepo.upsertConnection(actorUserId, {
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
 * that cannot be acted on. The run history is **kept**: it is keyed on the website, and it is the
 * only record of which days were already written — discarding it would mean a reconnect silently
 * re-sending them.
 *
 * The connection row is deleted even when the revoke call fails: leaving one we can no longer use
 * would show the customer a connection that does nothing. The grant they can remove themselves at
 * myaccount.google.com/permissions; a phantom row they cannot.
 */
export async function disconnect(actorUserId: string): Promise<void> {
  const connection = await requireConnection(actorUserId);

  try {
    await googleOAuth.revokeToken(
      decryptSecret(connection.refreshTokenCipher, SECRET_PURPOSES.googleRefreshToken),
    );
  } catch {
    // An undecryptable token cannot be revoked. Proceeding is still right — see above.
  }

  for (const target of await targetRepo.listTargetsForUser(actorUserId)) {
    await targetRepo.detachTarget(target.websiteId, actorUserId);
  }

  await connectionRepo.deleteConnectionForUser(actorUserId);
}

async function requireConnection(actorUserId: string): Promise<SheetsConnection> {
  const connection = await connectionRepo.findConnectionForUser(actorUserId);

  // "Not found" rather than "forbidden", the same as everywhere else: an actor learns nothing about
  // what exists for anyone else.
  if (!connection) throw notFound("No Google account has been connected.");

  return connection;
}

/** A connection that is actually usable, or a message explaining what the customer must do. */
async function requireUsableConnection(actorUserId: string): Promise<SheetsConnection> {
  assertConfigured();

  const connection = await requireConnection(actorUserId);

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
export async function getPickerToken(actorUserId: string): Promise<string> {
  const connection = await requireUsableConnection(actorUserId);
  return googleOAuth.getAccessToken(connection);
}

// ---------------------------------------------------------------------------
// Attaching a sheet to a website
// ---------------------------------------------------------------------------

/** Resolves a website through its owner. Reports "not found" for anything the actor does not own. */
async function requireWebsite(
  actorUserId: string,
  websiteId: unknown,
): Promise<{ id: string; name: string }> {
  const id = parseOrThrow(sheetTargetSchema.shape.websiteId, websiteId, "Choose a website.");
  const website = await websiteRepo.findWebsiteForUser(id, actorUserId);

  if (!website) throw notFound("That website does not exist.");

  return { id: website.id, name: website.name };
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
  const connection = await requireUsableConnection(actorUserId);
  const website = await requireWebsite(actorUserId, input.websiteId);
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
 * Named after the website so a customer with several can tell them apart in their Drive without
 * opening them. The file is theirs from the moment it exists — they can rename, move or share it and
 * the refresh keeps working, because Routely addresses it by id.
 */
export async function createSheetForWebsite(
  actorUserId: string,
  websiteId: unknown,
): Promise<{ spreadsheetId: string; spreadsheetName: string; sheetTitle: string }> {
  const connection = await requireUsableConnection(actorUserId);
  const website = await requireWebsite(actorUserId, websiteId);

  const created = await withAccessToken(connection, (token) =>
    sheets.createSpreadsheet(token, `Routely — ${website.name}`, SHEET_TAB_TITLE),
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
  const website = await requireWebsite(actorUserId, websiteId);
  const removed = await targetRepo.detachTarget(website.id, actorUserId);

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

  let targetId: string | null = null;

  try {
    const target = await targetRepo.claimRefresh(
      websiteId,
      options.force ? 0 : REFRESH_INTERVAL_MS,
      now,
    );

    // Either no spreadsheet is attached, or another request refreshed it moments ago. Both are
    // ordinary outcomes, not failures.
    if (!target) return { refreshed: false, reason: "throttled or no destination" };
    targetId = target.id;

    const connection = await connectionRepo.findConnectedGrant(target.website.userId);
    if (!connection) return { refreshed: false, reason: "no usable Google grant" };

    // Inclusive of today, so a window of 30 covers today and the 29 days before it.
    const from = utcDayRange(utcDaysEndingWith(utcDayKey(now), WINDOW_DAYS)[0] as string).from;
    const rows = await getArmRowsByDay(
      target.website.userId,
      { from, to: utcDayRange(utcDayKey(now)).to },
      websiteId,
    );

    const cells = buildDatedSheetRows(rows);

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
        worksheet.title,
        cells,
        target.rowCount,
      ),
    );

    await targetRepo.recordWrite(target.id, {
      sheetId: worksheet.sheetId,
      sheetTitle: worksheet.title,
      rowCount: cells.length,
    });

    return { refreshed: true, rows: cells.length };
  } catch (error) {
    const message = isAppError(error) ? error.message : "The refresh failed unexpectedly.";

    // Recorded so the UI can show why the numbers are stale, then swallowed — see (2) above.
    if (targetId) await targetRepo.recordError(targetId, message).catch(() => {});

    console.error(`[routely] sheet refresh failed for website ${websiteId}:`, message);

    return { refreshed: false, reason: "failed" };
  }
}

/** Refreshes one website on the customer's explicit request, ignoring the throttle. */
export async function refreshSheetForUser(
  actorUserId: string,
  websiteId: unknown,
): Promise<{ rows: number }> {
  await requireUsableConnection(actorUserId);
  const website = await requireWebsite(actorUserId, websiteId);

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
 * authenticates with a shared secret. Each website's rows are still scoped by both its owner's id
 * and its own id, so nothing crosses between customers or between sites.
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
