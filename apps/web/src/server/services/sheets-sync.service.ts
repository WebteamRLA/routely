import "server-only";

import { buildSheetRows } from "@/lib/sheet-rows";
import { previousUtcDay, utcDayRange, utcDaysEndingWith, type UtcDayKey } from "@/lib/utc-day";
import {
  SECRET_PURPOSES,
  decryptSecret,
  encryptSecret,
  isSecretStorageConfigured,
} from "@/server/crypto";
import { AppError, conflict, isAppError, notFound, validationFailed } from "@/server/errors";
import * as connectionRepo from "@/server/repositories/sheets-connection.repository";
import * as runRepo from "@/server/repositories/sheets-sync-run.repository";
import * as targetRepo from "@/server/repositories/website-sheet-target.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { getDailyArmRows } from "@/server/services/analytics.service";
import * as googleOAuth from "@/server/services/google-oauth.service";
import * as sheets from "@/server/services/google-sheets.service";
import { parseOrThrow } from "@/server/validate";
import { dayKeySchema, sheetTargetSchema } from "@/validation/integration";

import type { SheetsConnection, SheetsSyncRun } from "@/generated/prisma/client";

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
 * ## What "once per day" means here
 *
 * A website's rows for a day are written under a claim row whose `[websiteId, day]` uniqueness the
 * database enforces, taken **before** the append. That makes a duplicated cron invocation, or a
 * manual "Sync now" racing the schedule, harmless.
 *
 * It is **not exactly-once**, and nothing here should say that it is. If the append succeeds and the
 * bookkeeping write that follows does not — a process killed in the few hundred milliseconds between
 * them — the run stays PENDING and is never retried automatically. Google's append API has no
 * idempotency key, so a re-run cannot be deduplicated server-side; the only honest design is to make
 * the ambiguity visible and let a person who has looked at the spreadsheet decide. See
 * `docs/INTEGRATIONS.md`.
 */

/** Days back from yesterday that a definitely-failed write is retried. */
const RETRY_WINDOW_DAYS = 7;

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

export interface WebsiteSheetSummary {
  websiteId: string;
  websiteName: string;
  destination: null | {
    spreadsheetId: string;
    spreadsheetName: string | null;
    sheetTitle: string;
    createdByRoutely: boolean;
  };
  lastRun: null | Pick<
    SheetsSyncRun,
    "day" | "status" | "rowsWritten" | "updatedRange" | "error" | "finishedAt"
  >;
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

  // One query per website that actually has a destination, rather than one per website: a website
  // with no sheet has no runs to show.
  const lastRuns = await Promise.all(
    websites
      .filter((website) => targetByWebsite.has(website.id))
      .map(async (website) => {
        const [latest] = await runRepo.listRecentRuns(website.id, 1);
        return [website.id, latest ?? null] as const;
      }),
  );

  const lastRunByWebsite = new Map(lastRuns);

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
    websites: websites.map((website) => {
      const target = targetByWebsite.get(website.id);

      return {
        websiteId: website.id,
        websiteName: website.name,
        destination: target
          ? {
              spreadsheetId: target.spreadsheetId,
              spreadsheetName: target.spreadsheetName,
              sheetTitle: target.sheetTitle,
              createdByRoutely: target.createdByRoutely,
            }
          : null,
        lastRun: lastRunByWebsite.get(website.id) ?? null,
      };
    }),
  };
}

/** A website's destination and recent history, for the website's own page. */
export async function getWebsiteSheetStatus(
  actorUserId: string,
  websiteId: string,
): Promise<{
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  destination: WebsiteSheetSummary["destination"];
  recentRuns: SheetsSyncRun[];
}> {
  const [connection, target] = await Promise.all([
    connectionRepo.findConnectionForUser(actorUserId),
    targetRepo.findTargetForWebsite(websiteId, actorUserId),
  ]);

  return {
    configured: missingConfiguration() === null,
    connected: connection !== null,
    needsReconnect: connection?.status === "NEEDS_RECONNECT",
    destination: target
      ? {
          spreadsheetId: target.spreadsheetId,
          spreadsheetName: target.spreadsheetName,
          sheetTitle: target.sheetTitle,
          createdByRoutely: target.createdByRoutely,
        }
      : null,
    recentRuns: target ? await runRepo.listRecentRuns(websiteId, 7) : [],
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
 * The spreadsheet's name and the tab's title are read back from **Google**, never taken from the
 * form. A Server Action is a public HTTP endpoint, and the stored tab title is what builds the A1
 * range every nightly write targets — accepting it from the client would let a tampered submission
 * aim the write at a different tab.
 */
export async function attachPickedSheet(
  actorUserId: string,
  input: { websiteId: unknown; spreadsheetId: unknown; sheetId: unknown },
): Promise<{ spreadsheetName: string; sheetTitle: string }> {
  const connection = await requireUsableConnection(actorUserId);
  const website = await requireWebsite(actorUserId, input.websiteId);
  const target = parseOrThrow(sheetTargetSchema, input, "Check the spreadsheet you chose.");

  const metadata = await withAccessToken(connection, (token) =>
    sheets.getSpreadsheetMetadata(token, target.spreadsheetId),
  );

  const worksheet = metadata.worksheets.find((sheet) => sheet.sheetId === target.sheetId);

  if (!worksheet) {
    throw validationFailed("That worksheet is not in the spreadsheet. Choose one from the list.", {
      sheetId: ["Choose a worksheet"],
    });
  }

  await targetRepo.attachTarget(website.id, {
    spreadsheetId: target.spreadsheetId,
    spreadsheetName: metadata.spreadsheetName,
    sheetId: worksheet.sheetId,
    sheetTitle: worksheet.title,
    createdByRoutely: false,
  });

  return { spreadsheetName: metadata.spreadsheetName, sheetTitle: worksheet.title };
}

/**
 * Creates a fresh spreadsheet for a website and attaches it.
 *
 * Named after the website so a customer with several can tell them apart in their Drive without
 * opening them. The file is theirs from the moment it exists — they can rename, move or share it and
 * the sync keeps working, because Routely addresses it by id.
 */
export async function createSheetForWebsite(
  actorUserId: string,
  websiteId: unknown,
): Promise<{ spreadsheetId: string; spreadsheetName: string; sheetTitle: string }> {
  const connection = await requireUsableConnection(actorUserId);
  const website = await requireWebsite(actorUserId, websiteId);

  const created = await withAccessToken(connection, (token) =>
    sheets.createSpreadsheet(token, `Routely — ${website.name}`),
  );

  await targetRepo.attachTarget(website.id, {
    spreadsheetId: created.spreadsheetId,
    spreadsheetName: created.spreadsheetName,
    sheetId: created.worksheet.sheetId,
    sheetTitle: created.worksheet.title,
    createdByRoutely: true,
  });

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetName: created.spreadsheetName,
    sheetTitle: created.worksheet.title,
  };
}

/** The tabs of a spreadsheet the customer has already picked, so they can choose a different one. */
export async function listWorksheets(
  actorUserId: string,
  spreadsheetId: unknown,
): Promise<sheets.SpreadsheetMetadata> {
  const connection = await requireUsableConnection(actorUserId);
  const { spreadsheetId: id } = parseOrThrow(
    sheetTargetSchema.pick({ spreadsheetId: true }),
    { spreadsheetId },
    "Check the spreadsheet you chose.",
  );

  return withAccessToken(connection, (token) => sheets.getSpreadsheetMetadata(token, id));
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
// Writing a day
// ---------------------------------------------------------------------------

export interface SyncDayResult {
  day: UtcDayKey;
  outcome: "written" | "nothing-to-write" | "already-synced" | "skipped" | "failed";
  rowsWritten: number;
  /** A sentence for the customer. Always set — a silent outcome is never acceptable here. */
  message: string;
}

/** Syncs yesterday for one website. The "Sync now" button's entry point. */
export async function syncYesterday(
  actorUserId: string,
  websiteId: unknown,
  now: Date = new Date(),
): Promise<SyncDayResult> {
  return syncDay(actorUserId, websiteId, previousUtcDay(now), now);
}

/** Syncs one UTC day for one website. */
export async function syncDay(
  actorUserId: string,
  websiteId: unknown,
  day: unknown,
  now: Date = new Date(),
): Promise<SyncDayResult> {
  const connection = await requireUsableConnection(actorUserId);
  const website = await requireWebsite(actorUserId, websiteId);
  const dayKey = parseOrThrow(dayKeySchema, day, "Check the date you asked for.");

  const target = await targetRepo.findTargetForWebsite(website.id, actorUserId);

  if (!target) {
    throw conflict("Attach a spreadsheet to this website before syncing it.");
  }

  return writeDay(connection, target, dayKey, now);
}

/**
 * The one place a day is written.
 *
 * Order matters and is the whole design: claim, then read the data, then resolve the tab, then
 * append, then record. The claim is first so two workers cannot both reach the append; recording is
 * last because until Google has answered there is nothing truthful to record.
 */
async function writeDay(
  connection: SheetsConnection,
  target: targetRepo.TargetWithWebsite,
  day: UtcDayKey,
  now: Date,
): Promise<SyncDayResult> {
  const claim = await runRepo.claimRun(
    target.websiteId,
    day,
    { spreadsheetId: target.spreadsheetId, sheetTitle: target.sheetTitle },
    now,
  );

  if (claim.outcome === "already-synced") {
    return {
      day,
      outcome: "already-synced",
      rowsWritten: claim.run.rowsWritten ?? 0,
      message: `${day} was already synced for ${target.website.name}.`,
    };
  }

  if (claim.outcome === "skipped") {
    return { day, outcome: "skipped", rowsWritten: 0, message: claim.reason };
  }

  const run = claim.run;

  try {
    // Scoped to this website as well as to its owner, so one website's rows can never reach
    // another's spreadsheet.
    const rows = await getDailyArmRows(target.website.userId, utcDayRange(day), target.websiteId);

    /*
     * A day with no activity is recorded as SUCCEEDED having written nothing, rather than left
     * unclaimed. That distinction matters: "synced, nothing happened" and "never synced" look
     * identical in a spreadsheet, and only the run history can tell them apart.
     *
     * It also means Google is not called at all for a quiet day, which is most days for most
     * websites.
     */
    if (rows.length === 0) {
      await runRepo.completeRun(run.id, { status: "SUCCEEDED", rowsWritten: 0 }, new Date());

      return {
        day,
        outcome: "nothing-to-write",
        rowsWritten: 0,
        message: `Nothing to write for ${day} — no visitors were assigned on ${target.website.name}.`,
      };
    }

    // Resolved from the stored gid, never from the stored title: a tab renamed in Sheets changes its
    // title silently, and writing to a remembered name could hit the wrong tab.
    const sheetTitle = await withAccessToken(connection, (token) =>
      sheets.resolveWorksheetTitle(token, target.spreadsheetId, target.sheetId),
    );

    if (!target.headerWrittenAt) {
      const header = await withAccessToken(connection, (token) =>
        sheets.ensureHeaderRow(token, target.spreadsheetId, sheetTitle),
      );

      if (header.written) {
        await targetRepo.markHeaderWritten(target.id, new Date());
      }
    }

    const appended = await withAccessToken(connection, (token) =>
      sheets.appendRows(token, target.spreadsheetId, sheetTitle, buildSheetRows(day, rows)),
    );

    await runRepo.completeRun(
      run.id,
      {
        status: "SUCCEEDED",
        rowsWritten: appended.rowsWritten,
        updatedRange: appended.updatedRange,
      },
      new Date(),
    );

    return {
      day,
      outcome: "written",
      rowsWritten: appended.rowsWritten,
      message: `Wrote ${appended.rowsWritten} ${appended.rowsWritten === 1 ? "row" : "rows"} for ${day}.`,
    };
  } catch (error) {
    await recordFailure(run.id, target, error);
    throw error;
  }
}

/**
 * Records why a claimed run did not complete.
 *
 * The FAILED/UNKNOWN distinction is the reason this is its own function. A rejection from Google
 * proves nothing was written, because an append is applied atomically per request — that is safe to
 * retry. A timeout proves nothing at all, and retrying it could append the same day twice, so it is
 * recorded as UNKNOWN and left for a person.
 */
async function recordFailure(
  runId: string,
  target: targetRepo.TargetWithWebsite,
  error: unknown,
): Promise<void> {
  const indeterminate = sheets.isIndeterminate(error);
  const message = isAppError(error) ? error.message : "The sync failed for an unexpected reason.";

  await runRepo.completeRun(
    runId,
    {
      status: indeterminate ? "UNKNOWN" : "FAILED",
      error: indeterminate
        ? `${message} We do not know whether this day was written — check the spreadsheet before retrying.`
        : message,
    },
    new Date(),
  );

  // A destination that no longer exists would fail identically every night. Detaching it turns a
  // recurring silent failure into a visible "choose a spreadsheet" prompt on the website's page.
  if (sheets.isMissingDestination(error)) {
    await targetRepo.detachTarget(target.websiteId, target.website.userId);
  }
}

// ---------------------------------------------------------------------------
// The scheduled sweep
// ---------------------------------------------------------------------------

export interface SweepSummary {
  day: UtcDayKey;
  websites: number;
  written: number;
  nothingToWrite: number;
  alreadySynced: number;
  skipped: number;
  failed: number;
  retried: number;
  /** True when the wall-clock budget ran out before every website was visited. */
  truncated: boolean;
}

/**
 * Writes yesterday for every website that has a spreadsheet attached, then retries recent definite
 * failures.
 *
 * No `actorUserId`: this acts for every account and is reachable only from the cron route, which
 * authenticates with a shared secret. Each website's rows are still scoped by both its owner's id
 * and its own id inside `getDailyArmRows`, so nothing can cross between customers or between sites.
 *
 * A failure for one website never stops the sweep. Each is recorded on its own run row, which is also
 * why the endpoint returns 200 with counts rather than a 500: a partial success is the normal case,
 * and an HTTP error would hide which part succeeded.
 */
export async function runDailySweep(now: Date = new Date()): Promise<SweepSummary> {
  assertConfigured();

  const day = previousUtcDay(now);
  const deadline = now.getTime() + SWEEP_BUDGET_MS;
  const targets = await targetRepo.listSyncableTargets();

  const summary: SweepSummary = {
    day,
    websites: targets.length,
    written: 0,
    nothingToWrite: 0,
    alreadySynced: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    truncated: false,
  };

  // One grant per account, so several websites usually share one. Cached per sweep to avoid
  // refetching and re-refreshing the same token for each of them.
  const grants = new Map<string, SheetsConnection | null>();

  const grantFor = async (userId: string): Promise<SheetsConnection | null> => {
    if (!grants.has(userId)) {
      grants.set(userId, await connectionRepo.findConnectedGrant(userId));
    }

    return grants.get(userId) ?? null;
  };

  for (const target of targets) {
    // Checked between websites rather than mid-append: being killed by a platform timeout halfway
    // through a write is exactly what produces a run whose outcome nobody knows.
    if (Date.now() > deadline) {
      summary.truncated = true;
      break;
    }

    const connection = await grantFor(target.website.userId);

    if (!connection) {
      summary.skipped += 1;
      continue;
    }

    const outcome = await safeWriteDay(connection, target, day, new Date());

    if (outcome === "written") summary.written += 1;
    else if (outcome === "nothing-to-write") summary.nothingToWrite += 1;
    else if (outcome === "already-synced") summary.alreadySynced += 1;
    else if (outcome === "skipped") summary.skipped += 1;
    else summary.failed += 1;
  }

  for (const target of targets) {
    if (Date.now() > deadline) {
      summary.truncated = true;
      break;
    }

    const connection = await grantFor(target.website.userId);
    if (!connection) continue;

    // Only FAILED runs, and only within the window — UNKNOWN is never retried automatically.
    const retryable = await runRepo.listRetryableRuns(
      target.websiteId,
      utcDaysEndingWith(day, RETRY_WINDOW_DAYS),
    );

    for (const stale of retryable) {
      if (Date.now() > deadline) {
        summary.truncated = true;
        break;
      }

      const outcome = await safeWriteDay(connection, target, stale.day as UtcDayKey, new Date());
      if (outcome === "written" || outcome === "nothing-to-write") summary.retried += 1;
    }
  }

  return summary;
}

/** One website's write, with every failure contained so the sweep continues. */
async function safeWriteDay(
  connection: SheetsConnection,
  target: targetRepo.TargetWithWebsite,
  day: UtcDayKey,
  now: Date,
): Promise<SyncDayResult["outcome"]> {
  try {
    const result = await writeDay(connection, target, day, now);
    return result.outcome;
  } catch (error) {
    // Already recorded on the run row by `recordFailure`. Logged without the payload, which could
    // carry a token or a customer's data.
    console.error(
      `[routely] sheets sync failed for website ${target.websiteId} on ${day}:`,
      isAppError(error) ? error.message : "unexpected error",
    );

    return "failed";
  }
}
