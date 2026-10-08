import type {
  ArmConfig,
  ChangeConfig,
  ExperimentConfig,
  LegacyExperimentConfig,
  TargetingConfig,
} from "@routely/sdk/contract";

import { normalizeTargeting } from "@/lib/targeting";

/**
 * Builds what `/api/v1/config` publishes to the SDK from stored experiments.
 *
 * Pure, so the shape the browser receives — which experiments, which arms, what targeting — is
 * unit-tested rather than discovered on a customer's page. The route handler only loads rows
 * and picks the protocol.
 */

type MatchType = "EXACT" | "PREFIX";

/** The columns the config needs. `config.repository.ts` selects exactly these. */
export interface ConfigExperimentRow {
  id: string;
  type: "SPLIT_URL" | "AB";
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  controlUrl: string;
  controlMatchType: MatchType;
  controlWeight: number;
  trafficAllocation: number;
  conversionUrl: string | null;
  conversionMatchType: MatchType;
  goalMetricId: string | null;
  targeting: unknown;
  winnerPosition: number | null;
  keepWinner: boolean;
  variants: { id: string; position: number; url: string; weight: number; changes: unknown }[];
}

/**
 * The visitor's country from the platform's geo header: Vercel's, else Cloudflare's. `null`
 * when absent or a placeholder (`XX` unknown, `T1` Tor) — and an unknown country is *included*
 * by country targeting, see `passesGeo`.
 */
export function countryFromHeaders(headers: { get(name: string): string | null }): string | null {
  const raw = (headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(raw) && raw !== "XX" ? raw : null;
}

/**
 * Whether country targeting lets this visitor in.
 *
 * Fails **open** when the country is unknown — a self-hosted deployment with no geo header, a
 * local dev server, a privacy proxy. Failing closed would silently switch every geo-targeted
 * experiment off wherever geo is unavailable, which is the harder failure to notice; failing
 * open means an "only US" test may include some visitors whose country could not be told.
 * An empty country list is treated the same way (the wizard refuses to launch one).
 */
export function passesGeo(
  targeting: { geo: "all" | "some"; geoMode: "include" | "exclude"; countries: string[] },
  country: string | null,
): boolean {
  if (targeting.geo !== "some" || targeting.countries.length === 0 || country === null) return true;
  const listed = targeting.countries.includes(country);
  return targeting.geoMode === "exclude" ? !listed : listed;
}

/** Whether the response for this experiment depends on the visitor's country. */
export function usesGeo(row: Pick<ConfigExperimentRow, "targeting" | "controlUrl">): boolean {
  if (row.targeting === null || row.targeting === undefined) return false;
  const t = normalizeTargeting(row.targeting, row.controlUrl);
  return t.geo === "some" && t.countries.length > 0;
}

const MAX_SELECTOR = 1000;
const MAX_VALUE = 5000;

/** Keeps only well-formed `{selector, prop, value}` changes; drops the editor-only `el`. */
export function sanitizeChanges(raw: unknown): ChangeConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: ChangeConfig[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { selector, prop, value } = item as Record<string, unknown>;
    if (typeof selector !== "string" || !selector.trim() || selector.length > MAX_SELECTOR)
      continue;
    if (prop !== "text" && prop !== "bg" && prop !== "image") continue;
    if (typeof value !== "string" || value.length > MAX_VALUE) continue;
    out.push({ selector: selector.trim(), prop, value });
  }
  return out;
}

/**
 * The page rule and entry conditions the SDK evaluates, plus whether geo lets this visitor in.
 *
 * An experiment with no stored targeting keeps the uppercase legacy rule — its control URL
 * under the normalised-URL EXACT/PREFIX semantics it was created with — rather than being
 * reinterpreted by the targeting step's looser `exact` (which ignores the query string).
 */
export function targetingFor(
  row: Pick<ConfigExperimentRow, "targeting" | "controlUrl" | "controlMatchType">,
  country: string | null,
): { targeting: TargetingConfig; allowed: boolean } {
  if (row.targeting === null || row.targeting === undefined) {
    return {
      allowed: true,
      targeting: {
        match: row.controlMatchType,
        pattern: row.controlUrl,
        audience: "all",
        devices: ["desktop", "tablet", "mobile"],
        logic: "all",
        conditions: [],
      },
    };
  }

  const t = normalizeTargeting(row.targeting, row.controlUrl);
  return {
    allowed: passesGeo(t, country),
    targeting: {
      match: t.match,
      pattern: t.pattern,
      audience: t.audience,
      devices: t.devices,
      logic: t.logic,
      // A condition that names no parameter cannot be evaluated; the wizard refuses to save one.
      conditions: t.conditions
        .filter((c) => c.field !== "query" || c.key.trim() !== "")
        .map((c) => ({ field: c.field, key: c.key.trim(), op: c.op, value: c.value })),
    },
  };
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 100) : 100;
}

/** Arms in draw order: control (position 0, the experiment's own page) then each variant. */
export function armsFor(row: ConfigExperimentRow): ArmConfig[] {
  const isAb = row.type === "AB";
  const variants = [...row.variants].sort((a, b) => a.position - b.position);
  return [
    isAb
      ? { position: 0, variantId: null, weight: row.controlWeight, changes: [] }
      : { position: 0, variantId: null, weight: row.controlWeight, url: row.controlUrl },
    ...variants.map((variant): ArmConfig =>
      isAb
        ? {
            position: variant.position,
            variantId: variant.id,
            weight: variant.weight,
            changes: sanitizeChanges(variant.changes),
          }
        : {
            position: variant.position,
            variantId: variant.id,
            weight: variant.weight,
            url: variant.url,
          },
    ),
  ];
}

/** True for a completed Split URL test that keeps sending its traffic to a winning variant. */
export function isLockedWinner(row: ConfigExperimentRow): boolean {
  return (
    row.status === "ARCHIVED" &&
    row.type === "SPLIT_URL" &&
    row.keepWinner &&
    (row.winnerPosition ?? 0) > 0 &&
    row.variants.some((variant) => variant.position === row.winnerPosition)
  );
}

/**
 * One experiment as protocol v4 publishes it, or `null` when this visitor's country is
 * excluded or the row is neither running nor a kept winner.
 *
 * `preview` serves the row whatever its status — for `?routely_preview=` — with no geo check
 * and no winner lock: the person previewing chose the arm.
 */
export function toV4Experiment(
  row: ConfigExperimentRow,
  country: string | null,
  options: { preview?: boolean } = {},
): ExperimentConfig | null {
  const { targeting, allowed } = targetingFor(row, country);

  if (options.preview) {
    return {
      id: row.id,
      type: row.type === "AB" ? "ab" : "redirect",
      targeting,
      coverage: 100,
      arms: armsFor(row),
      preview: true,
    };
  }

  if (!allowed) return null;

  if (isLockedWinner(row)) {
    const winner = row.variants.find((variant) => variant.position === row.winnerPosition)!;
    return { id: row.id, type: "redirect", locked: true, targeting, target: winner.url };
  }

  if (row.status !== "ACTIVE") return null;

  return {
    id: row.id,
    type: row.type === "AB" ? "ab" : "redirect",
    targeting,
    coverage: clampPercent(row.trafficAllocation),
    arms: armsFor(row),
  };
}

/**
 * One experiment as protocol v3 published it, for bundles still cached from before v4.
 *
 * Only running Split URL tests: a v3 bundle cannot apply element changes, so an A/B test is
 * left out rather than half-run. Targeting is not expressible in v3 and is ignored — a v3
 * bundle runs on the control URL for everyone, as it always did. A metric goal has no URL; it
 * is published as an empty one, which never matches, so a v3 bundle sends no conversion for it.
 */
export function toV3Experiment(row: ConfigExperimentRow): LegacyExperimentConfig | null {
  if (row.status !== "ACTIVE" || row.type !== "SPLIT_URL" || row.variants.length === 0) {
    return null;
  }
  return {
    id: row.id,
    control: { url: row.controlUrl, match: row.controlMatchType },
    controlWeight: row.controlWeight,
    variants: [...row.variants]
      .sort((a, b) => a.position - b.position)
      .map((variant) => ({ id: variant.id, url: variant.url, weight: variant.weight })),
    goal: {
      url: row.goalMetricId === null ? (row.conversionUrl ?? "") : "",
      match: row.conversionMatchType,
    },
    trafficAllocation: row.trafficAllocation,
  };
}
