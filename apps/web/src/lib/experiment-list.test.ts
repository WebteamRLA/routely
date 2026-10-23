import { describe, expect, it } from "vitest";

import {
  type ListItemInput,
  buildListItem,
  listPath,
  tileFor,
  updatedLabel,
} from "@/lib/experiment-list";

const NOW = new Date("2026-10-12T15:00:00.000Z");

function row(overrides: Partial<ListItemInput> = {}): ListItemInput {
  return {
    id: "cmexp123",
    name: "Homepage hero headline",
    type: "AB_TEST",
    status: "ACTIVE",
    controlUrl: "https://fernwoodsupply.com/",
    variantUrl: null,
    trafficAllocation: 50,
    updatedAt: new Date("2026-09-22T13:10:00.000Z"),
    arms: [
      { name: "Control", visitors: 0, conversions: 0 },
      { name: "Variant A", visitors: 0, conversions: 0 },
    ],
    changedByViewerJustNow: false,
    resultsHref: "/experiments/cmexp123",
    editHref: "/experiments/new/ab-test?id=cmexp123",
    ...overrides,
  };
}

const arms = (c: [number, number], ...v: [number, number][]) => [
  { name: "Control", visitors: c[0], conversions: c[1] },
  ...v.map(([visitors, conversions], i) => ({
    name: `Variant ${"ABC"[i]}`,
    visitors,
    conversions,
  })),
];

describe("buildListItem notes and rates", () => {
  const note = (o: Partial<ListItemInput>) => buildListItem(row(o), { now: NOW }).note;

  it("draft: no visitors, no rate, no note, edits in the wizard", () => {
    const item = buildListItem(row({ status: "DRAFT", name: "  " }), { now: NOW });
    expect(item).toMatchObject({
      name: "Untitled experiment",
      visitors: null,
      rate: null,
      note: "",
      resultsHref: null,
      editHref: "/experiments/new/ab-test?id=cmexp123",
    });
  });

  it("running or paused with no visitors", () => {
    expect(note({})).toBe("no data yet");
    expect(note({ status: "PAUSED" })).toBe("no data yet");
  });

  it("running below the gate collects; paused below the gate says so", () => {
    expect(note({ arms: arms([999, 100], [1000, 150]) })).toBe("collecting data");
    expect(note({ status: "PAUSED", arms: arms([1000, 99], [1000, 150]) })).toBe(
      "paused before a result",
    );
  });

  it("running past the gate shows percentage points vs control", () => {
    // 4.10% − 3.49% → +0.6 pts; 2.51% − 2.70% → −0.2 pts (the design's e5 and e6)
    expect(note({ arms: arms([6240, 218], [6240, 256]) })).toBe("+0.6 pts vs control");
    expect(note({ arms: arms([4110, 111], [4105, 103]) })).toBe("−0.2 pts vs control");
  });

  it("completed: winner, control, flat, too early", () => {
    expect(note({ status: "COMPLETED", arms: arms([10650, 298], [10656, 362]) })).toBe(
      "variant won",
    );
    expect(note({ status: "COMPLETED", arms: arms([1000, 100], [1000, 150], [1000, 101]) })).toBe(
      "Variant A won",
    );
    expect(note({ status: "COMPLETED", arms: arms([1000, 150], [1000, 100]) })).toBe("control won");
    expect(note({ status: "COMPLETED", arms: arms([1000, 100], [1000, 102]) })).toBe(
      "no clear winner",
    );
    expect(note({ status: "COMPLETED", arms: arms([3105, 68], [3105, 44]) })).toBe(
      "ended before a result",
    );
  });

  it("pools the rate over every arm, as a percentage", () => {
    const item = buildListItem(row({ arms: arms([6240, 218], [6240, 256]) }), { now: NOW });
    expect(item.visitors).toBe(12480);
    expect(item.rate!.toFixed(1)).toBe("3.8");
    expect(item.variants).toBe(2);
  });
});

describe("listPath", () => {
  it("A/B shows the tested path; Split URL shows both", () => {
    expect(
      listPath({ type: "AB_TEST", controlUrl: "https://acme.com/cart", variantUrl: null }),
    ).toBe("/cart");
    expect(
      listPath({
        type: "SPLIT_URL",
        controlUrl: "https://acme.com/pricing",
        variantUrl: "https://acme.com/pricing-b",
      }),
    ).toBe("/pricing → /pricing-b");
    expect(
      listPath({
        type: "SPLIT_URL",
        controlUrl: "https://acme.com/pricing",
        variantUrl: "https://acme.com/pricing-a",
        variantCount: 4,
      }),
    ).toBe("/pricing → 4 variants");
    expect(listPath({ type: "AB_TEST", controlUrl: null, variantUrl: null })).toBe(
      "No page set yet",
    );
  });
});

describe("updatedLabel", () => {
  it("today, yesterday, a date, and just now", () => {
    expect(updatedLabel(new Date("2026-10-12T09:12:00.000Z"), { now: NOW })).toEqual({
      label: "Today",
      time: "9:12 AM",
    });
    expect(updatedLabel(new Date("2026-10-11T16:05:00.000Z"), { now: NOW })).toEqual({
      label: "Yesterday",
      time: "4:05 PM",
    });
    expect(updatedLabel(new Date("2026-10-10T16:20:00.000Z"), { now: NOW })).toEqual({
      label: "Oct 10",
      time: "4:20 PM",
    });
    expect(updatedLabel(new Date("2025-10-10T16:20:00.000Z"), { now: NOW }).label).toBe(
      "Oct 10, 2025",
    );
    expect(updatedLabel(new Date(NOW.getTime() - 10_000), { now: NOW, byViewer: true })).toEqual({
      label: "Just now",
      time: "by you",
    });
  });

  it("decides the day in the viewer's zone", () => {
    // 20:00 UTC on Oct 11 is 02:00 on Oct 12 in Dhaka — "Today" there, "Yesterday" in UTC.
    const at = new Date("2026-10-11T20:00:00.000Z");
    expect(updatedLabel(at, { now: NOW }).label).toBe("Yesterday");
    expect(updatedLabel(at, { now: NOW, timeZone: "Asia/Dhaka" })).toEqual({
      label: "Today",
      time: "2:00 AM",
    });
  });
});

describe("tileFor", () => {
  it("is stable per id", () => {
    expect(tileFor("cmabc")).toEqual(tileFor("cmabc"));
  });
});
