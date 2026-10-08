import { describe, expect, it } from "vitest";

import {
  type ConfigExperimentRow,
  countryFromHeaders,
  passesGeo,
  sanitizeChanges,
  toV3Experiment,
  toV4Experiment,
  usesGeo,
} from "@/lib/sdk-config";

const row = (over: Partial<ConfigExperimentRow> = {}): ConfigExperimentRow => ({
  id: "exp_1",
  type: "SPLIT_URL",
  status: "ACTIVE",
  controlUrl: "https://acme.test/pricing",
  controlMatchType: "EXACT",
  controlWeight: 50,
  trafficAllocation: 100,
  conversionUrl: "https://acme.test/thanks",
  conversionMatchType: "EXACT",
  goalMetricId: null,
  targeting: null,
  winnerPosition: null,
  keepWinner: false,
  variants: [
    { id: "v2", position: 2, url: "https://acme.test/p3", weight: 25, changes: [] },
    { id: "v1", position: 1, url: "https://acme.test/p2", weight: 25, changes: [] },
  ],
  ...over,
});

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("countryFromHeaders", () => {
  it("prefers Vercel's header, falls back to Cloudflare's", () => {
    expect(countryFromHeaders(headers({ "x-vercel-ip-country": "de" }))).toBe("DE");
    expect(countryFromHeaders(headers({ "cf-ipcountry": "US" }))).toBe("US");
  });

  it("treats absent and placeholder values as unknown", () => {
    expect(countryFromHeaders(headers({}))).toBeNull();
    expect(countryFromHeaders(headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(countryFromHeaders(headers({ "cf-ipcountry": "T1" }))).toBeNull();
  });
});

describe("passesGeo", () => {
  const some = { geo: "some" as const, geoMode: "include" as const, countries: ["US", "CA"] };

  it("includes and excludes listed countries", () => {
    expect(passesGeo(some, "US")).toBe(true);
    expect(passesGeo(some, "DE")).toBe(false);
    expect(passesGeo({ ...some, geoMode: "exclude" }, "US")).toBe(false);
    expect(passesGeo({ ...some, geoMode: "exclude" }, "DE")).toBe(true);
  });

  it("fails open when the country is unknown or no country is listed", () => {
    expect(passesGeo(some, null)).toBe(true);
    expect(passesGeo({ ...some, countries: [] }, "DE")).toBe(true);
    expect(passesGeo({ ...some, geo: "all" }, "DE")).toBe(true);
  });
});

describe("toV4Experiment", () => {
  it("publishes a running Split URL test with control first and arms in position order", () => {
    expect(toV4Experiment(row(), null)).toEqual({
      id: "exp_1",
      type: "redirect",
      targeting: {
        match: "EXACT",
        pattern: "https://acme.test/pricing",
        audience: "all",
        devices: ["desktop", "tablet", "mobile"],
        logic: "all",
        conditions: [],
      },
      coverage: 100,
      arms: [
        { position: 0, variantId: null, weight: 50, url: "https://acme.test/pricing" },
        { position: 1, variantId: "v1", weight: 25, url: "https://acme.test/p2" },
        { position: 2, variantId: "v2", weight: 25, url: "https://acme.test/p3" },
      ],
    });
  });

  it("keeps the legacy PREFIX rule for an experiment with no stored targeting", () => {
    const config = toV4Experiment(row({ controlMatchType: "PREFIX" }), null);
    expect(config?.targeting.match).toBe("PREFIX");
  });

  it("publishes stored targeting without the geo fields the browser cannot evaluate", () => {
    const config = toV4Experiment(
      row({
        targeting: {
          match: "contains",
          pattern: "/pricing",
          audience: "new",
          devices: ["mobile"],
          geo: "some",
          geoMode: "include",
          countries: ["US"],
          logic: "any",
          conditions: [
            { field: "utm_source", key: "", op: "equals", value: "ads" },
            { field: "query", key: "", op: "exists", value: "" },
          ],
        },
      }),
      "US",
    );
    expect(config?.targeting).toEqual({
      match: "contains",
      pattern: "/pricing",
      audience: "new",
      devices: ["mobile"],
      logic: "any",
      // The query condition with no parameter name cannot be evaluated and is dropped.
      conditions: [{ field: "utm_source", key: "", op: "equals", value: "ads" }],
    });
  });

  it("leaves out an experiment the visitor's country is excluded from", () => {
    const geo = row({ targeting: { geo: "some", geoMode: "include", countries: ["US"] } });
    expect(toV4Experiment(geo, "DE")).toBeNull();
    expect(toV4Experiment(geo, "US")).not.toBeNull();
    expect(toV4Experiment(geo, null)).not.toBeNull();
    expect(usesGeo(geo)).toBe(true);
    expect(usesGeo(row())).toBe(false);
  });

  it("publishes A/B arms with sanitised changes and no URLs", () => {
    const config = toV4Experiment(
      row({
        type: "AB",
        variants: [
          {
            id: "v1",
            position: 1,
            url: "",
            weight: 50,
            changes: [
              { selector: "h1", prop: "text", value: "Hi", el: "headline" },
              { selector: "", prop: "text", value: "dropped" },
              { selector: ".x", prop: "html", value: "dropped" },
            ],
          },
        ],
      }),
      null,
    );
    expect(config).toMatchObject({
      type: "ab",
      arms: [
        { position: 0, variantId: null, weight: 50, changes: [] },
        {
          position: 1,
          variantId: "v1",
          weight: 50,
          changes: [{ selector: "h1", prop: "text", value: "Hi" }],
        },
      ],
    });
  });

  it("clamps coverage", () => {
    expect(toV4Experiment(row({ trafficAllocation: 140 }), null)).toMatchObject({ coverage: 100 });
  });

  it("serves a completed test that keeps its winner as a locked redirect", () => {
    expect(
      toV4Experiment(row({ status: "ARCHIVED", keepWinner: true, winnerPosition: 2 }), null),
    ).toEqual(
      expect.objectContaining({ id: "exp_1", locked: true, target: "https://acme.test/p3" }),
    );
  });

  it("serves nothing for a completed test without a kept variant winner", () => {
    expect(
      toV4Experiment(row({ status: "ARCHIVED", keepWinner: true, winnerPosition: 0 }), null),
    ).toBeNull();
    expect(toV4Experiment(row({ status: "ARCHIVED", winnerPosition: 1 }), null)).toBeNull();
    expect(
      toV4Experiment(
        row({ status: "ARCHIVED", type: "AB", keepWinner: true, winnerPosition: 1 }),
        null,
      ),
    ).toBeNull();
    expect(toV4Experiment(row({ status: "PAUSED" }), null)).toBeNull();
    expect(toV4Experiment(row({ status: "DRAFT" }), null)).toBeNull();
  });

  it("serves any status for a preview, flagged, ignoring geo", () => {
    const draft = row({
      status: "DRAFT",
      targeting: { geo: "some", geoMode: "include", countries: ["US"] },
    });
    expect(toV4Experiment(draft, "DE", { preview: true })).toMatchObject({
      id: "exp_1",
      preview: true,
      coverage: 100,
    });
  });
});

describe("toV3Experiment", () => {
  it("keeps the v3 shape for cached bundles", () => {
    expect(toV3Experiment(row())).toEqual({
      id: "exp_1",
      control: { url: "https://acme.test/pricing", match: "EXACT" },
      controlWeight: 50,
      variants: [
        { id: "v1", url: "https://acme.test/p2", weight: 25 },
        { id: "v2", url: "https://acme.test/p3", weight: 25 },
      ],
      goal: { url: "https://acme.test/thanks", match: "EXACT" },
      trafficAllocation: 100,
    });
  });

  it("leaves out A/B tests and anything not running, and blanks a metric goal", () => {
    expect(toV3Experiment(row({ type: "AB" }))).toBeNull();
    expect(toV3Experiment(row({ status: "PAUSED" }))).toBeNull();
    expect(toV3Experiment(row({ goalMetricId: "m1" }))?.goal.url).toBe("");
  });
});

describe("sanitizeChanges", () => {
  it("returns an empty list for anything that is not a list", () => {
    expect(sanitizeChanges(null)).toEqual([]);
    expect(sanitizeChanges({ selector: "h1" })).toEqual([]);
  });
});
