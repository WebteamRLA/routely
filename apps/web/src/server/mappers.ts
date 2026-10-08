/**
 * Database rows → `lib/domain` / `lib/view-models` shapes, and the reverse for enums.
 *
 * Pure: no database access, no `server-only` import, so it is unit-testable. Services fetch,
 * then map through here, so every page sees the same vocabulary (`running`, not `ACTIVE`).
 */

import type {
  CountingMode,
  Experiment,
  ExperimentStatus,
  ExperimentType,
  Metric,
  UrlMatchType,
} from "@/generated/prisma/client";
import {
  armColor,
  armName,
  type Change,
  type CountingKey,
  type DisplayStatusKey,
  type DraftErrors,
  type ExperimentDraftSource,
  type ExperimentKind,
  type ExperimentStatusKey,
  type Targeting,
} from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { matches, normalizeTargeting } from "@/lib/targeting";
import { controlUrlsConflict, isSameSite, isSameUrl } from "@/lib/url";
import type { ArmView, GoalView } from "@/lib/view-models";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

const STATUS_KEY: Record<ExperimentStatus, ExperimentStatusKey> = {
  DRAFT: "draft",
  ACTIVE: "running",
  PAUSED: "paused",
  ARCHIVED: "completed",
};

export function statusKey(status: ExperimentStatus): ExperimentStatusKey {
  return STATUS_KEY[status];
}

export function statusFromKey(key: ExperimentStatusKey): ExperimentStatus {
  return (Object.keys(STATUS_KEY) as ExperimentStatus[]).find((s) => STATUS_KEY[s] === key)!;
}

/** `winner` is a completed experiment whose declared winner is a variant (position > 0). */
export function displayStatus(
  status: ExperimentStatus,
  winnerPosition: number | null,
): DisplayStatusKey {
  return status === "ARCHIVED" && winnerPosition !== null && winnerPosition > 0
    ? "winner"
    : STATUS_KEY[status];
}

export function kindKey(type: ExperimentType): ExperimentKind {
  return type === "AB" ? "ab" : "redirect";
}

export function typeFromKind(kind: ExperimentKind): ExperimentType {
  return kind === "ab" ? "AB" : "SPLIT_URL";
}

export function countingKey(mode: CountingMode): CountingKey {
  return mode === "ALL" ? "all" : "unique";
}

export function countingFromKey(key: CountingKey): CountingMode {
  return key === "all" ? "ALL" : "UNIQUE";
}

export function matchKey(match: UrlMatchType): "exact" | "starts" {
  return match === "PREFIX" ? "starts" : "exact";
}

export function matchFromKey(key: "exact" | "starts"): UrlMatchType {
  return key === "starts" ? "PREFIX" : "EXACT";
}

// ---------------------------------------------------------------------------
// Arms and changes
// ---------------------------------------------------------------------------

/** Reads `ExperimentVariant.changes` (JSON) into `Change[]`, dropping anything malformed. */
export function parseChanges(raw: unknown): Change[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): Change[] => {
    if (!entry || typeof entry !== "object") return [];
    const c = entry as Record<string, unknown>;
    if (typeof c["selector"] !== "string" || typeof c["value"] !== "string") return [];
    if (c["prop"] !== "text" && c["prop"] !== "bg" && c["prop"] !== "image") return [];
    const el = c["el"];
    return [
      {
        selector: c["selector"],
        prop: c["prop"],
        value: c["value"],
        ...(typeof el === "string" &&
        ["eyebrow", "headline", "sub", "cta", "trust", "image"].includes(el)
          ? { el: el as Change["el"] }
          : {}),
      },
    ];
  });
}

export interface ExperimentWithVariantsRow extends Experiment {
  variants: { id: string; position: number; url: string; weight: number; changes: unknown }[];
}

/** Control (position 0) followed by variants in position order. */
export function armsOf(experiment: ExperimentWithVariantsRow): ArmView[] {
  const isAb = experiment.type === "AB";
  const variants = [...experiment.variants].sort((a, b) => a.position - b.position);
  return [
    {
      position: 0,
      variantId: null,
      name: armName(0),
      color: armColor(0),
      url: isAb ? "" : experiment.controlUrl,
      weight: experiment.controlWeight,
      changes: [],
    },
    ...variants.map((variant, index) => ({
      position: index + 1,
      variantId: variant.id,
      name: armName(index + 1),
      color: armColor(index + 1),
      url: isAb ? "" : variant.url,
      weight: variant.weight,
      changes: isAb ? parseChanges(variant.changes) : [],
    })),
  ];
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/** The `Conversion.goalKey` of an experiment's primary goal. */
export function primaryGoalKey(experiment: Pick<Experiment, "goalMetricId">): string {
  return experiment.goalMetricId ?? "url";
}

export function urlGoalView(url: string, match: UrlMatchType): GoalView {
  const path = pathOf(url) || url;
  return {
    mode: "url",
    key: "url",
    metricId: null,
    name: `Reached ${path}`,
    eventKey: path,
    url,
    match: matchKey(match),
  };
}

export function metricGoalView(
  metric: Pick<Metric, "id" | "name" | "key" | "url" | "matchType">,
): GoalView {
  return {
    mode: "event",
    key: metric.id,
    metricId: metric.id,
    name: metric.name,
    eventKey: metric.key,
    url: metric.url,
    match: matchKey(metric.matchType),
  };
}

/** The primary goal for display, or null when none is configured (a draft). */
export function primaryGoalView(
  experiment: Pick<Experiment, "goalMetricId" | "conversionUrl" | "conversionMatchType">,
  metricsById: Map<string, Pick<Metric, "id" | "name" | "key" | "url" | "matchType">>,
): GoalView | null {
  if (experiment.goalMetricId) {
    const metric = metricsById.get(experiment.goalMetricId);
    return metric ? metricGoalView(metric) : null;
  }
  return experiment.conversionUrl
    ? urlGoalView(experiment.conversionUrl, experiment.conversionMatchType)
    : null;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

/** What `draftFromExperiment` (lib/validate-draft) needs to open a stored experiment. */
export function draftSourceOf(experiment: ExperimentWithVariantsRow): ExperimentDraftSource {
  return {
    id: experiment.id,
    projectId: experiment.websiteId,
    type: kindKey(experiment.type),
    name: experiment.name,
    url: experiment.controlUrl,
    hypothesis: experiment.description,
    arms: armsOf(experiment).map((arm) => ({
      id: arm.variantId,
      name: arm.name,
      url: arm.url,
      weight: arm.weight,
      changes: arm.changes,
    })),
    coverage: experiment.trafficAllocation,
    targeting: experiment.targeting ?? null,
    goalMetricId: experiment.goalMetricId,
    conversionUrl: experiment.conversionUrl,
    conversionMatch: matchKey(experiment.conversionMatchType),
    secondaryMetricIds: [...experiment.secondaryMetricIds],
    counting: countingKey(experiment.countingMode),
  };
}

// ---------------------------------------------------------------------------
// Domains and page rules
// ---------------------------------------------------------------------------

/** True when `url` is on any of the project's domains or a subdomain (dot-anchored). */
export function onProjectDomain(url: string, domains: readonly string[]): boolean {
  return domains.some((domain) => isSameSite(url, domain));
}

export interface PageRule {
  url: string;
  targeting: Targeting;
}

/** The page rule an experiment claims: its targeting, falling back to its URL exactly. */
export function pageRuleOf(experiment: Pick<Experiment, "controlUrl" | "targeting">): PageRule {
  return {
    url: experiment.controlUrl,
    targeting: normalizeTargeting(experiment.targeting, experiment.controlUrl),
  };
}

const SIMPLE_MATCH = { exact: "EXACT", starts: "PREFIX" } as const;

/**
 * Whether two experiments could both claim the same page view — the "one active experiment per
 * page" rule, extended from control URLs to page rules.
 *
 *  - Disjoint device sets never overlap (a desktop-only and a mobile-only test can share a page).
 *  - Two `exact`/`starts` rules are compared exactly, with `controlUrlsConflict` (normalised
 *    URLs, path-boundary prefixes) — the original rule.
 *  - Any rule involving `contains`, `wildcard` or `regex` cannot be compared in general, so each
 *    rule is tested against the other's concrete URLs (its experiment URL and its test URL): if
 *    either rule claims a page the other is known to run on, they conflict. This catches every
 *    realistic clash (`/blog/*` vs `/blog/post`) without pretending to decide regex overlap.
 *
 * Audience, location and query conditions are deliberately not considered: two tests whose
 * conditions merely *probably* don't overlap would still mix whenever they did.
 */
export function pageRulesOverlap(a: PageRule, b: PageRule): boolean {
  if (!a.targeting.devices.some((device) => b.targeting.devices.includes(device))) return false;

  if (a.url && b.url && isSameUrl(a.url, b.url)) return true;

  const simpleA = a.targeting.match === "exact" || a.targeting.match === "starts";
  const simpleB = b.targeting.match === "exact" || b.targeting.match === "starts";
  if (simpleA && simpleB) {
    return controlUrlsConflict(
      {
        url: a.targeting.pattern || a.url,
        match: SIMPLE_MATCH[a.targeting.match as "exact" | "starts"],
      },
      {
        url: b.targeting.pattern || b.url,
        match: SIMPLE_MATCH[b.targeting.match as "exact" | "starts"],
      },
    );
  }

  const samples = (rule: PageRule) =>
    [rule.url, rule.targeting.testUrl].filter((url) => url && !url.includes("*"));
  const claims = (rule: PageRule, url: string) =>
    matches(rule.targeting.match, rule.targeting.pattern, url) === true;

  return samples(b).some((url) => claims(a, url)) || samples(a).some((url) => claims(b, url));
}

/** Two-letter initials from a name or, failing that, an email. */
export function initialsOf(name: string | null | undefined, email: string): string {
  const source = (name ?? "").trim();
  if (source) {
    const words = source.split(/\s+/).filter(Boolean);
    const letters =
      words.length > 1 ? `${words[0]![0]}${words[words.length - 1]![0]}` : source.slice(0, 2);
    return letters.toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/** `{ basics: { url: "…" } }` → `{ "basics.url": ["…"] }`, the FormState field-error shape. */
export function flattenDraftErrors(errors: DraftErrors): Record<string, string[]> {
  const flat: Record<string, string[]> = {};
  for (const [step, fields] of Object.entries(errors)) {
    for (const [key, message] of Object.entries(fields ?? {})) {
      flat[`${step}.${key}`] = [message];
    }
  }
  return flat;
}
