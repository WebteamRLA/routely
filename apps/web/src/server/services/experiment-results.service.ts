import "server-only";

import { env } from "@/env";
import type { ExperimentStatus, ExperimentType, MemberRole } from "@/generated/prisma/client";
import { changeSummaries } from "@/lib/change-summary";
import { type ExperimentListItem, buildListItem } from "@/lib/experiment-list";
import {
  type ActivityInput,
  type ActivityType,
  type ArmInput,
  type ExperimentModel,
  ORIGINAL_PAGE,
  type ResultsInput,
  type ReviewInput,
  type UrlCheckInput,
  buildExperimentModel,
} from "@/lib/experiment-model";
import { changeCount, shortUrl } from "@/lib/launch-rules";
import { can } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import { armShares } from "@/lib/traffic";
import { normalizeUrl } from "@/lib/url";
import { utcDayKey } from "@/lib/utc-day";
import { type ArmDayCounts, cumulativeSeries, resultStatusOf } from "@/lib/verdict";
import { findRole } from "@/server/auth/workspace";
import { notFound } from "@/server/errors";
import * as assignmentRepo from "@/server/repositories/assignment.repository";
import * as conversionRepo from "@/server/repositories/conversion.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import type { ExperimentWithWebsite } from "@/server/repositories/experiment.repository";
import * as resultsRepo from "@/server/repositories/experiment-results.repository";
import { safeTimeZone } from "@/server/http/viewer-time-zone";
import * as websiteRepo from "@/server/repositories/website.repository";
import * as analyticsService from "@/server/services/analytics.service";
import * as trackingCheckService from "@/server/services/tracking-check.service";

/**
 * Read models for the results screens: the experiments list, an experiment's Results and Review
 * tabs, and the public share page.
 *
 * The rule is the same as everywhere: the actor comes first and every read is resolved through
 * the workspace membership filter, so a non-member gets NOT_FOUND — the same as an id that does
 * not exist. The share page is the one exception, and it is a separately named function that
 * takes a token instead of an actor.
 *
 * Metrics have one source each (CLAUDE.md §5): visitors are `count(assignments)` and conversions
 * `count(conversions)`, grouped by the arm both tables carry; rates divide by *assigned* visitors.
 * Every verdict, chance and note is computed by `lib/verdict.ts` through `lib/experiment-model.ts`
 * and `lib/experiment-list.ts`, which are pure — this file only gathers the facts.
 *
 * Nothing here writes. Lifecycle changes (pause, resume, end, launch) belong to
 * `experiment.service`; the Review tab's "Check again" calls `tracking-check.service`.
 */

export interface ReadOptions {
  /** Defaults to the current instant. */
  now?: Date;
  /** IANA zone for date labels; anything unrecognised falls back to UTC. */
  timeZone?: string;
}

function shareUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}${routes.share(token)}`;
}

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------

interface ArmCounts {
  assigned: Map<string | null, number>;
  converted: Map<string | null, number>;
}

function launchedAt(experiment: ExperimentWithWebsite): Date {
  // A launched experiment always has publishedAt; a row from before it was stamped falls back.
  return experiment.publishedAt ?? experiment.createdAt;
}

function armsOf(experiment: ExperimentWithWebsite, counts: ArmCounts): ArmInput[] {
  const shares = armShares({
    controlWeight: experiment.controlWeight,
    variantWeights: experiment.variants.map((variant) => variant.weight),
    trafficAllocation: 100,
  });
  const isAb = experiment.type === "AB_TEST";

  const control: ArmInput = {
    key: null,
    name: "Control",
    colorIndex: 0,
    pct: shares.control,
    url: isAb ? null : experiment.controlUrl,
    lines: [isAb ? ORIGINAL_PAGE : shortUrl(experiment.controlUrl)],
    changeCount: 0,
    visitors: counts.assigned.get(null) ?? 0,
    conversions: counts.converted.get(null) ?? 0,
  };
  const variants = experiment.variants.map((variant, index): ArmInput => {
    const summaries = isAb ? changeSummaries(variant.changes) : [];
    return {
      key: variant.id,
      name: variant.name.trim() || `Variant ${String.fromCharCode(65 + index)}`,
      colorIndex: variant.colorIndex,
      pct: shares.variants[index] ?? 0,
      url: isAb ? null : variant.url,
      lines: isAb
        ? summaries.length > 0
          ? summaries
          : ["No saved changes"]
        : [shortUrl(variant.url)],
      changeCount: isAb ? changeCount(variant.changes) : 0,
      visitors: counts.assigned.get(variant.id) ?? 0,
      conversions: counts.converted.get(variant.id) ?? 0,
    };
  });
  return [control, ...variants];
}

type DetailStatusName = Exclude<ExperimentStatus, "DRAFT">;

function resultsInput(
  experiment: ExperimentWithWebsite & { status: DetailStatusName },
  arms: ArmInput[],
  rows: analyticsService.DatedArmRow[],
  resumedAt: Date | null,
  now: Date,
): ResultsInput {
  const published = launchedAt(experiment);
  const end = experiment.status === "COMPLETED" ? (experiment.endedAt ?? now) : now;
  const dayRows: ArmDayCounts[] = rows.map((row) => ({
    day: row.day,
    armKey: row.variantId,
    visitors: row.assignedVisitors,
    conversions: row.conversions,
  }));
  const series = cumulativeSeries(
    dayRows,
    arms.map((arm) => arm.key),
    published,
    end < published ? published : end,
  );

  return {
    id: experiment.id,
    name: experiment.name.trim() || "Untitled experiment",
    type: experiment.type === "AB_TEST" ? "ab" : "split",
    status: resultStatusOf(experiment.status) as ResultsInput["status"],
    controlUrl: experiment.controlUrl ?? "",
    goalUrl: experiment.conversionUrl ?? "",
    include: experiment.trafficAllocation,
    publishedAt: published.toISOString(),
    pausedAt: experiment.pausedAt?.toISOString() ?? null,
    endedAt: experiment.endedAt?.toISOString() ?? null,
    resumedAt: resumedAt?.toISOString() ?? null,
    now: now.toISOString(),
    arms,
    series: {
      days: series.days,
      visitors: series.arms.map((arm) => arm.visitors),
      conversions: series.arms.map((arm) => arm.conversions),
    },
  };
}

/** The run's window for the cumulative chart: launch day through the end (or now). */
function seriesRange(experiment: ExperimentWithWebsite, now: Date): { from: Date; to: Date } {
  const published = launchedAt(experiment);
  const from = new Date(`${utcDayKey(published)}T00:00:00.000Z`);
  const to = experiment.status === "COMPLETED" ? (experiment.endedAt ?? now) : now;
  return { from, to: to < from ? from : to };
}

function fieldsOf(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const record = meta as Record<string, unknown>;
  for (const key of ["fields", "changed"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  }
  const changes = record["changes"];
  if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    return Object.keys(changes);
  }
  return [];
}

function activityInput(rows: resultsRepo.ActivityRow[]): ActivityInput[] {
  return rows.map((row) => ({
    id: row.id,
    type: row.type as ActivityType,
    actorName: row.actorName,
    system: row.actorId === null && row.type === "RESULT_READY",
    at: row.createdAt.toISOString(),
    fields: fieldsOf(row.meta),
  }));
}

function sameUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a === b || (normalizeUrl(a) ?? a) === (normalizeUrl(b) ?? b);
}

// ---------------------------------------------------------------------------------------------
// Detail (Results + Review)
// ---------------------------------------------------------------------------------------------

export type ExperimentDetail =
  | { kind: "draft"; id: string; type: ExperimentType; wizardHref: string }
  | {
      kind: "results";
      id: string;
      type: ExperimentType;
      websiteId: string;
      model: ExperimentModel;
      role: MemberRole;
      /** Pause, resume, end and "Check again" (Editor and up). */
      canEdit: boolean;
      /** Create, rotate or turn off the public results link (Editor and up). */
      canShare: boolean;
      /** The current public link; only filled in for someone who may manage it. */
      shareUrl: string | null;
    };

async function loadAccess(actorUserId: string, experimentId: string) {
  const access = await experimentRepo.findExperimentAccess(experimentId, actorUserId);
  if (!access) throw notFound("That experiment does not exist.");
  return access;
}

/**
 * Everything `/experiments/[id]` renders. A draft has no results — the caller sends it to its
 * wizard instead, so that case returns only where to go.
 */
export async function getExperimentDetail(
  actorUserId: string,
  experimentId: string,
  options: ReadOptions = {},
): Promise<ExperimentDetail> {
  const { experiment, role } = await loadAccess(actorUserId, experimentId);
  if (experiment.status === "DRAFT") {
    return {
      kind: "draft",
      id: experiment.id,
      type: experiment.type,
      wizardHref: routes.experiments.wizard(experiment.type, experiment.id),
    };
  }
  const launched = experiment as ExperimentWithWebsite & { status: DetailStatusName };
  const now = options.now ?? new Date();
  const timeZone = safeTimeZone(options.timeZone);

  const [assigned, converted, rows, activity, tracking, createdByName] = await Promise.all([
    assignmentRepo.countAssignmentsByVariant(experiment.id),
    conversionRepo.countConversionsByVariant(experiment.id),
    analyticsService.getArmRowsByDay(
      actorUserId,
      seriesRange(experiment, now),
      undefined,
      experiment.id,
    ),
    resultsRepo.listActivity(actorUserId, experiment.id),
    trackingCheckService.getExperimentTracking(actorUserId, experiment.id),
    experiment.createdById ? resultsRepo.findDisplayName(experiment.createdById) : null,
  ]);

  const resumed = [...activity].reverse().find((row) => row.type === "RESUMED");
  const arms = armsOf(experiment, { assigned, converted });
  const input = resultsInput(launched, arms, rows, resumed?.createdAt ?? null, now);

  const urlChecks: UrlCheckInput[] = tracking.map((entry) => ({
    url: entry.url,
    role: sameUrl(entry.url, experiment.controlUrl)
      ? "control"
      : sameUrl(entry.url, experiment.conversionUrl)
        ? "goal"
        : "variant",
    result: entry.check?.result ?? null,
    pageLoaded: entry.check?.pageLoaded ?? false,
    detail: entry.check?.detail ?? null,
    checkedAt: entry.check?.checkedAt.toISOString() ?? null,
  }));

  const review: ReviewInput = {
    domain: experiment.website.domain,
    devices: experiment.targetDevices,
    createdAt: experiment.createdAt.toISOString(),
    createdByName,
    lastSeenAt: experiment.website.lastSeenAt?.toISOString() ?? null,
    pixelVerifiedAt: experiment.website.pixelVerifiedAt?.toISOString() ?? null,
    urlChecks,
    activity: activityInput(activity),
  };

  const canShare = can(role, "share.manage");
  return {
    kind: "results",
    id: experiment.id,
    type: experiment.type,
    websiteId: experiment.websiteId,
    model: buildExperimentModel(input, review, { timeZone }),
    role,
    canEdit: can(role, "experiment.edit"),
    canShare,
    shareUrl: canShare && experiment.shareToken ? shareUrl(experiment.shareToken) : null,
  };
}

/** The Results tab alone (arms, verdict, tiles, cumulative series). NOT_FOUND for a draft. */
export async function getResults(
  actorUserId: string,
  experimentId: string,
  options: ReadOptions = {},
) {
  const detail = await getExperimentDetail(actorUserId, experimentId, options);
  if (detail.kind === "draft") throw notFound("That experiment has no results yet.");
  const { review: _review, ...results } = detail.model;
  return results;
}

/** The Review tab alone (health, checks, at a glance, configuration, activity). */
export async function getReview(
  actorUserId: string,
  experimentId: string,
  options: ReadOptions = {},
) {
  const detail = await getExperimentDetail(actorUserId, experimentId, options);
  if (detail.kind === "draft" || !detail.model.review) {
    throw notFound("That experiment has no results yet.");
  }
  return detail.model.review;
}

// ---------------------------------------------------------------------------------------------
// Public share page
// ---------------------------------------------------------------------------------------------

/**
 * Results for the public share page, by token. No actor: the token is the authorization, and an
 * unknown or revoked token is null (the page renders a 404 either way). Only the Results tab is
 * built — the Review tab names teammates and shows tracking internals, which a link-holder has no
 * need for. A draft that somehow has a token has nothing to show, so it is null too.
 */
export async function getSharedResults(
  token: string,
  options: ReadOptions = {},
): Promise<ExperimentModel | null> {
  if (!token || token.length > 200) return null;
  const experiment = await experimentRepo.findExperimentByShareToken(token);
  if (!experiment || experiment.status === "DRAFT") return null;
  const launched = experiment as ExperimentWithWebsite & { status: DetailStatusName };
  const now = options.now ?? new Date();

  const [assigned, converted, rows, resumedAt] = await Promise.all([
    assignmentRepo.countAssignmentsByVariant(experiment.id),
    conversionRepo.countConversionsByVariant(experiment.id),
    analyticsService.getSharedExperimentArmRowsByDay(experiment.id, seriesRange(experiment, now)),
    resultsRepo.latestResumedAt(experiment.id),
  ]);
  const arms = armsOf(experiment, { assigned, converted });
  const input = resultsInput(launched, arms, rows, resumedAt, now);
  return buildExperimentModel(input, null, { timeZone: safeTimeZone(options.timeZone) });
}

// ---------------------------------------------------------------------------------------------
// The experiments list
// ---------------------------------------------------------------------------------------------

export interface ExperimentList {
  items: ExperimentListItem[];
  /** The project the list is narrowed to, when it is. */
  project: { id: string; name: string } | null;
  /** May create, pause and resume here (Editor and up). */
  canEdit: boolean;
}

/**
 * The rows of `/experiments`: one project's experiments (`projectId`), or every experiment in the
 * actor's active workspace. Newest change first. Filtering by search, type and status happens in
 * the browser over this full list — the counts beside each filter need the unfiltered set anyway.
 */
export async function listExperiments(
  actorUserId: string,
  scope: { workspaceId: string; projectId?: string },
  options: ReadOptions = {},
): Promise<ExperimentList> {
  let project: ExperimentList["project"] = null;
  let role: MemberRole | null;

  if (scope.projectId) {
    const access = await websiteRepo.findWebsiteAccess(scope.projectId, actorUserId);
    if (!access) throw notFound("That project does not exist.");
    project = { id: access.website.id, name: access.website.name };
    role = access.role;
  } else {
    role = await findRole(scope.workspaceId, actorUserId);
    if (!role) throw notFound("That workspace does not exist.");
  }

  const experiments = await resultsRepo.listExperimentsForList(
    actorUserId,
    project ? { websiteId: project.id } : { workspaceId: scope.workspaceId },
  );
  return {
    items: await toListItems(actorUserId, experiments, options),
    project,
    canEdit: can(role, "experiment.edit"),
  };
}

/** One project's rows — the list scoped as the design scopes it. */
export async function listProjectExperiments(
  actorUserId: string,
  projectId: string,
  options: ReadOptions = {},
): Promise<ExperimentListItem[]> {
  const access = await websiteRepo.findWebsiteAccess(projectId, actorUserId);
  if (!access) throw notFound("That project does not exist.");
  const experiments = await resultsRepo.listExperimentsForList(actorUserId, {
    websiteId: projectId,
  });
  return toListItems(actorUserId, experiments, options);
}

async function toListItems(
  actorUserId: string,
  experiments: resultsRepo.ListedExperiment[],
  options: ReadOptions,
): Promise<ExperimentListItem[]> {
  const now = options.now ?? new Date();
  const timeZone = safeTimeZone(options.timeZone);
  const ids = experiments.map((experiment) => experiment.id);
  const [counts, latest] = await Promise.all([
    resultsRepo.countArmsForExperiments(actorUserId, ids),
    resultsRepo.latestActivityByExperiment(actorUserId, ids),
  ]);

  return experiments.map((experiment) => {
    const c = counts.get(experiment.id);
    const last = latest.get(experiment.id);
    const arm = (key: string | null, name: string) => ({
      name,
      visitors: c?.assigned.get(key) ?? 0,
      conversions: c?.converted.get(key) ?? 0,
    });
    return buildListItem(
      {
        id: experiment.id,
        name: experiment.name,
        type: experiment.type,
        status: experiment.status,
        controlUrl: experiment.controlUrl,
        variantUrl: experiment.variants[0]?.url ?? null,
        trafficAllocation: experiment.trafficAllocation,
        updatedAt: experiment.updatedAt,
        arms: [
          arm(null, "Control"),
          ...experiment.variants.map((variant) => arm(variant.id, variant.name)),
        ],
        changedByViewerJustNow:
          last !== undefined &&
          last.actorId === actorUserId &&
          now.getTime() - last.createdAt.getTime() < 60_000,
        resultsHref: routes.experiments.detail(experiment.id),
        editHref: routes.experiments.wizard(experiment.type, experiment.id),
      },
      { now, timeZone },
    );
  });
}
