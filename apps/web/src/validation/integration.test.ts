import { describe, expect, it } from "vitest";

import { dayKeySchema, sheetGidSchema, spreadsheetRefSchema } from "@/validation/integration";

describe("spreadsheetRefSchema", () => {
  const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

  it("extracts the id from a pasted spreadsheet URL", () => {
    // What a customer actually copies out of the address bar.
    for (const url of [
      `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit?gid=123456#gid=123456`,
      `https://docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`,
    ]) {
      expect(spreadsheetRefSchema.safeParse(url)).toMatchObject({ success: true, data: ID });
    }
  });

  it("accepts a bare id", () => {
    expect(spreadsheetRefSchema.safeParse(ID)).toMatchObject({ success: true, data: ID });
  });

  it("trims surrounding whitespace, as a paste often carries", () => {
    expect(spreadsheetRefSchema.safeParse(`  ${ID}  `)).toMatchObject({ success: true, data: ID });
  });

  it("rejects anything that does not contain an id", () => {
    for (const bad of [
      "",
      "   ",
      "https://docs.google.com/spreadsheets/",
      "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
      "not a url",
      "short",
    ]) {
      // The Docs URL is worth listing explicitly: it also has a `/d/<id>` segment, but the
      // path pattern requires `/spreadsheets/d/`, so a link to a Google Doc is refused here
      // rather than being sent to the Sheets API to be refused there.
      expect(
        spreadsheetRefSchema.safeParse(bad).success,
        `expected ${JSON.stringify(bad)} to be rejected`,
      ).toBe(false);
    }
  });

  it("rejects an id carrying path separators", () => {
    // This is the control that matters: the id is interpolated into a Google API URL path.
    for (const bad of [
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74Ogv/../../v4/spreadsheets",
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74Ogv%2Fvalues",
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs?x=1",
    ]) {
      expect(
        spreadsheetRefSchema.safeParse(bad).success,
        `expected ${JSON.stringify(bad)} to be rejected`,
      ).toBe(false);
    }
  });
});

describe("sheetGidSchema", () => {
  it("accepts zero, which is the first tab of every new spreadsheet", () => {
    expect(sheetGidSchema.safeParse(0).success).toBe(true);
  });

  it("accepts a real gid", () => {
    expect(sheetGidSchema.safeParse(1234567890).success).toBe(true);
  });

  it("rejects negatives, fractions and non-numbers", () => {
    for (const bad of [-1, 1.5, "0", null, Number.NaN, 2_147_483_648]) {
      expect(
        sheetGidSchema.safeParse(bad).success,
        `expected ${JSON.stringify(bad)} to be rejected`,
      ).toBe(false);
    }
  });
});

describe("dayKeySchema", () => {
  it("accepts a real UTC day", () => {
    expect(dayKeySchema.safeParse("2026-09-28").success).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    expect(dayKeySchema.safeParse("2026-02-30").success).toBe(false);
    expect(dayKeySchema.safeParse("2026-9-28").success).toBe(false);
    expect(dayKeySchema.safeParse("yesterday").success).toBe(false);
  });
});
