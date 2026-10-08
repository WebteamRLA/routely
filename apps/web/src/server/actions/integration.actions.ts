"use server";

import { revalidatePath } from "next/cache";

import { routes } from "@/lib/routes";
import { type FormState, runAction } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import { rateLimit } from "@/server/http/rate-limit";
import * as sheetsSync from "@/server/services/sheets-sync.service";

/**
 * Server Actions for the Google Sheets integration.
 *
 * The actor always comes from the session — a Server Action is a public HTTP endpoint, so the
 * connection is resolved by `userId` and every `websiteId` in a form body is validated and then
 * re-resolved through that owner before anything is written.
 *
 * Several of these are deliberately **not** form actions: the Google Picker needs a token, and the
 * picker's result has to be saved from a callback rather than a submission. Those return plain data
 * and never throw across the boundary — a thrown `AppError` arrives at a client component as `{}`.
 * `checkInstallOnPageAction` in `pixel.actions.ts` is the existing precedent.
 */

/** Revalidates every page that shows a website's sheet status (all live under /p/<id>). */
function revalidateSheetViews(websiteId: string): void {
  revalidatePath(routes.project(websiteId).dashboard, "layout");
}

export type PickerTokenResult = { ok: true; accessToken: string } | { ok: false; message: string };

/**
 * A short-lived access token for the Google Picker.
 *
 * The token carries only `drive.file`, so it grants access to spreadsheets Routely created plus
 * whatever the customer picks with it — not the rest of their Drive. See `getPickerToken` in the
 * service for the full reasoning on why handing it to the browser is sound.
 */
export async function getPickerTokenAction(): Promise<PickerTokenResult> {
  const user = await requireUser();

  const result = await runAction(() => sheetsSync.getPickerToken(user.id));

  if (!result.ok) {
    return { ok: false, message: result.state.message ?? "Could not start the Google picker." };
  }

  return { ok: true, accessToken: result.data };
}

export type AttachResult =
  { ok: true; spreadsheetName: string; sheetTitle: string } | { ok: false; message: string };

/**
 * Attaches the spreadsheet the customer chose in the Picker.
 *
 * Called from the Picker's callback rather than a form submit, which is why it returns data instead
 * of a `FormState`.
 */
export async function attachPickedSheetAction(input: {
  websiteId: string;
  spreadsheetId: string;
}): Promise<AttachResult> {
  const user = await requireUser();

  const result = await runAction(() => sheetsSync.attachPickedSheet(user.id, input));

  if (!result.ok) {
    return { ok: false, message: result.state.message ?? "Could not attach that spreadsheet." };
  }

  revalidateSheetViews(input.websiteId);

  return { ok: true, ...result.data };
}

/** Creates a new spreadsheet for a website and attaches it. */
export async function createSheetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");

  // Creating a file in someone's Drive is a real side effect, so an impatient double-click must not
  // leave two spreadsheets behind. Per-process, the same limitation `rateLimit` already carries.
  const limit = rateLimit(`sheets-create:${user.id}`, 5, 60_000);

  if (!limit.allowed) {
    return {
      status: "error",
      message: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  const result = await runAction(() => sheetsSync.createSheetForWebsite(user.id, websiteId));
  if (!result.ok) return result.state;

  revalidateSheetViews(websiteId);

  return {
    status: "success",
    message: `Created “${result.data.spreadsheetName}” in your Google Drive.`,
  };
}

/** Stops syncing a website. The spreadsheet itself is untouched. */
export async function detachSheetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");

  const result = await runAction(() => sheetsSync.detachSheet(user.id, websiteId));
  if (!result.ok) return result.state;

  revalidateSheetViews(websiteId);

  return {
    status: "success",
    message: "Stopped syncing to Google Sheets. Your spreadsheet was not changed.",
  };
}

/**
 * Refreshes one website's spreadsheet now, ignoring the throttle.
 *
 * Traffic refreshes the tab on its own, so this is for the impatient case and for confirming the
 * connection works while someone is looking at it. Throttled per customer all the same: a refresh is
 * several Google round trips, and an impatient double-click should not queue four of them.
 */
export async function refreshSheetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");

  const limit = rateLimit(`sheets-refresh:${user.id}`, 10, 60_000);

  if (!limit.allowed) {
    return {
      status: "error",
      message: `Too many refreshes. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  const result = await runAction(() => sheetsSync.refreshSheetForUser(user.id, websiteId));
  if (!result.ok) return result.state;

  revalidateSheetViews(websiteId);

  return {
    status: "success",
    message:
      result.data.rows === 0
        ? "Refreshed — no visitors have been assigned in the last 30 days."
        : `Refreshed: ${result.data.rows} ${result.data.rows === 1 ? "row" : "rows"} written.`,
  };
}

/** Revokes at Google and removes every website's destination. */
export async function disconnectSheetsAction(
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const result = await runAction(() => sheetsSync.disconnect(user.id));
  if (!result.ok) return result.state;

  // The grant is per account, so every project's integrations page changes.
  revalidatePath("/p/[projectId]", "layout");

  return { status: "success", message: "Google disconnected. Your spreadsheets were not changed." };
}
