/**
 * Page and audience targeting: matching, the plain-language summary, tolerant parsing of the
 * stored JSON, and field validation. `matches` and `targetSummary` are verbatim ports of the
 * design prototype.
 */

import { stripU } from "./domain-normalize";
import {
  ALL_DEVICES,
  COUNTRIES,
  defaultTargeting,
  type Audience,
  type ConditionField,
  type ConditionOp,
  type Device,
  type PageMatch,
  type TargetCondition,
  type Targeting,
} from "./domain";

export const PAGE_MATCHES: readonly PageMatch[] = [
  "exact",
  "contains",
  "starts",
  "wildcard",
  "regex",
];

/** Options for the page-rule select, labelled as in the design. */
export const MATCH_OPTIONS: { value: PageMatch; label: string }[] = [
  { value: "exact", label: "Exactly matches" },
  { value: "contains", label: "Contains" },
  { value: "starts", label: "Starts with" },
  { value: "wildcard", label: "Matches wildcard (*)" },
  { value: "regex", label: "Matches regex" },
];

const CONDITION_FIELDS: readonly ConditionField[] = [
  "query",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "referrer",
];
const CONDITION_OPS: readonly ConditionOp[] = ["equals", "not", "contains", "exists"];
const AUDIENCES: readonly Audience[] = ["all", "new", "returning"];

/**
 * Whether `url` satisfies the page rule.
 *
 * `null` when either side is empty (nothing to test yet); `"invalid"` when a regex rule does
 * not compile. All modes except `regex` compare the `stripU` forms (no protocol, query or
 * trailing slash); `regex` tests the raw URL. A wildcard `*` matches any run of characters,
 * and a URL also matches when a trailing slash would make it match (`/blog/*` ⇒ `/blog`).
 */
export function matches(
  match: PageMatch,
  pattern: string,
  url: string,
): boolean | null | "invalid" {
  if (!pattern || !url) return null;
  const u = stripU(url);
  const p = stripU(pattern);
  switch (match) {
    case "exact":
      return u === p;
    case "contains":
      return u.includes(p);
    case "starts":
      return u.startsWith(p);
    case "wildcard": {
      const re = new RegExp(
        "^" +
          p
            .split("*")
            .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$",
      );
      return re.test(u) || re.test(u + "/");
    }
    case "regex":
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return "invalid";
      }
  }
  return null;
}

const ML: Record<PageMatch, string> = {
  exact: "exactly match",
  contains: "contain",
  starts: "start with",
  wildcard: "match",
  regex: "match the regex",
};
const AUD: Record<Audience, string> = {
  all: "all visitors",
  new: "new visitors",
  returning: "returning visitors",
};
const OL: Record<ConditionOp, string> = {
  equals: "is",
  not: "is not",
  contains: "contains",
  exists: "exists",
};

/** Country name for an ISO code (the code itself when unknown). */
export function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/**
 * One sentence describing who an experiment runs for, e.g. "Runs for all visitors on any
 * device in all locations, on pages that exactly match acme.com/pricing."
 */
export function targetSummary(t: Targeting): string {
  const aud = AUD[t.audience];
  const dev =
    t.devices.length === 3
      ? "on any device"
      : t.devices.length
        ? "on " + t.devices.join(" and ")
        : "on no devices";
  const geo =
    t.geo === "all"
      ? "in all locations"
      : t.countries.length
        ? (t.geoMode === "exclude" ? "outside " : "in ") + t.countries.map(countryName).join(", ")
        : "in no locations yet";
  const cond = t.conditions.length
    ? ", when " +
      t.conditions
        .map(
          (c) =>
            (c.field === "query" ? c.key || "param" : c.field) +
            " " +
            OL[c.op] +
            (c.op === "exists" ? "" : " “" + (c.value || "…") + "”"),
        )
        .join(t.logic === "all" ? " and " : " or ")
    : "";
  return (
    "Runs for " +
    aud +
    " " +
    dev +
    " " +
    geo +
    ", on pages that " +
    ML[t.match] +
    " " +
    (stripU(t.pattern) || "…") +
    cond +
    "."
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Reads a stored `Experiment.targeting` value (or anything else) into a complete `Targeting`.
 *
 * Never throws. Missing or malformed fields take the defaults (`defaultTargeting`); a missing
 * pattern falls back to `fallbackPattern` (normally the experiment URL), so a null column means
 * "the control URL, exactly, for everyone". Unknown devices, countries in the wrong shape and
 * malformed conditions are dropped. Countries are upper-cased ISO codes, de-duplicated.
 */
export function normalizeTargeting(raw: unknown, fallbackPattern = ""): Targeting {
  const base = defaultTargeting(fallbackPattern);
  if (!isObject(raw)) return base;

  const pattern = str(raw["pattern"]).trim() ? str(raw["pattern"]) : fallbackPattern;

  const devices = Array.isArray(raw["devices"])
    ? ALL_DEVICES.filter((d) => (raw["devices"] as unknown[]).includes(d))
    : [...base.devices];

  const countries = Array.isArray(raw["countries"])
    ? [
        ...new Set(
          (raw["countries"] as unknown[])
            .filter((c): c is string => typeof c === "string" && /^[a-z]{2}$/i.test(c.trim()))
            .map((c) => c.trim().toUpperCase()),
        ),
      ]
    : [];

  const conditions: TargetCondition[] = Array.isArray(raw["conditions"])
    ? (raw["conditions"] as unknown[]).filter(isObject).map((c) => ({
        field: oneOf(c["field"], CONDITION_FIELDS, "query"),
        key: str(c["key"]),
        op: oneOf(c["op"], CONDITION_OPS, "equals"),
        value: typeof c["value"] === "number" ? String(c["value"]) : str(c["value"]),
      }))
    : [];

  return {
    match: oneOf(raw["match"], PAGE_MATCHES, base.match),
    pattern,
    testUrl: str(raw["testUrl"]) || pattern,
    audience: oneOf(raw["audience"], AUDIENCES, base.audience),
    devices: devices as Device[],
    geo: oneOf(raw["geo"], ["all", "some"] as const, base.geo),
    geoMode: oneOf(raw["geoMode"], ["include", "exclude"] as const, base.geoMode),
    countries,
    logic: oneOf(raw["logic"], ["all", "any"] as const, base.logic),
    conditions,
  };
}

/** Whether a string compiles as a JavaScript regular expression. */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Field errors for the Targeting step, keyed as the prototype keys them: `pattern`, `devices`,
 * `geo`, `k<i>` (missing query-parameter name for condition i) and `c<i>` (missing value for
 * condition i). Messages are verbatim.
 */
export function targetingErrors(t: Targeting): Record<string, string> {
  const e: Record<string, string> = {};
  if (!t.pattern.trim()) e["pattern"] = "Enter a page URL or pattern.";
  else if (t.match === "regex" && !isValidRegex(t.pattern)) {
    e["pattern"] = "Invalid regular expression.";
  }
  if (!t.devices.length) e["devices"] = "Select at least one device type.";
  if (t.geo === "some" && !t.countries.length) {
    e["geo"] = "Add at least one country, or target all locations.";
  }
  t.conditions.forEach((c, i) => {
    if (c.field === "query" && !c.key.trim()) e["k" + i] = "Enter the parameter name.";
    if (c.op !== "exists" && !String(c.value).trim()) e["c" + i] = "Enter a value.";
  });
  return e;
}
