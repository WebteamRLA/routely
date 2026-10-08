import "server-only";

import { randomBytes } from "node:crypto";

import { env } from "@/env";
import type { Experiment, ExperimentStatus, Metric, Prisma } from "@/generated/prisma/client";
import {
  armName,
  type DraftErrors,
  type ExperimentDraft,
  type ExperimentKind,
  type ExperimentStatusKey,
  MAX_ARMS,
  type WizardStepKey,
} from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { normalizeTargeting } from "@/lib/targeting";
import { validateDraft } from "@/lib/validate-draft";
import type { ArmTotals, ExperimentDetail, ExperimentListItem } from "@/lib/view-models";
import { db } from "@/server/db";
import { conflict, notFound, validationFailed } from "@/server/errors";
import {
  armsOf,
  countingFromKey,
  countingKey,
  displayStatus,
  draftSourceOf,
  flattenDraftErrors,
  kindKey,
  matchFromKey,
  metricGoalView,
  onProjectDomain,
  pageRuleOf,
  pageRulesOverlap,
  primaryGoalView,
  statusFromKey,
  statusKey,
  typeFromKind,
} from "@/server/mappers";
import * as activityRepo from "@/server/repositories/activity.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import * as metricRepo from "@/server/repositories/metric.repository";
import type * as websiteRepo from "@/server/repositories/website.repository";
import { primaryTotalsFor } from "@/server/services/analytics.service";
import { projectDomains, requireProject } from "@/server/services/website.service";
import { parseOrThrow } from "@/server/validate";
import {
  type ExperimentDraftInput,
  changeSchema,
  editLiveExperimentSchema,
  endExperimentSchema,
  experimentDraftSchema,
} from "@/validation/experiment";

/**
 * Experiment business logic.
 *
 * As with websites, `actorUserId` is threaded into every query — here through the parent
 * website relation — so ownership is enforced in the same statement that reads or writes. The
 * project-scoped functions (the new UI) additionally require the experiment to belong to the
 * project in the URL, so `/p/A/experiments/<id of B's experiment>` is "not found" even for
 * the owner of both.
 *
 * Rules that need data a Zod schema cannot see live here: the same-site rule needs the
 * project's domains, the conflict rule needs the project's other experiments, goal ownership
 * needs its metrics.
 *
 * Status mapping (database → UI): DRAFT = draft, ACTIVE = running, PAUSED = paused,
 * ARCHIVED = completed (+ `winnerPosition`).
 */

// ===========================================================================================
// Project-scoped API (the new UI)
// ===========================================================================================

const UNTITLED = "Untitled experiment";

/** Display name of the acting user for activity rows. */
async function actorName(actorUserId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: actorUserId },
    select: { name: true, email: true },
  });
  return user ? user.name?.trim() || user.email : null;
}

async function logActivity(
  experimentId: string,
  actorUserId: string,
  text: string,
  client: Parameters<typeof activityRepo.recordActivity>[1] = db,
): Promise<void> {
  await activityRepo.recordActivity(
    { experimentId, actorName: await actorName(actorUserId), text },
    client,
  );
}

/** An experiment of the project, ownership-checked. NOT_FOUND otherwise. */
async function requireExperimentInProject(
  actorUserId: string,
  projectId: string,
  experimentId: string,
): Promise<experimentRepo.ExperimentWithWebsite> {
  const experiment = await experimentRepo.findExperimentInProject(
    experimentId,
    projectId,
    actorUserId,
  );
  if (!experiment) throw notFound("That experiment does not exist.");
  return experiment;
}

async function metricsById(projectId: string, actorUserId: string): Promise<Map<string, Metric>> {
  const metrics = await metricRepo.listMetricsForProject(projectId, actorUserId);
  return new Map(metrics.map((metric) => [metric.id, metric]));
}

function daysRunning(experiment: Experiment, now: Date): number {
  if (!experiment.publishedAt) return 0;
  const end = experiment.status === "ARCHIVED" && experiment.stoppedAt ? experiment.stoppedAt : now;
  return Math.max(1, Math.ceil((end.getTime() - experiment.publishedAt.getTime()) / 86_400_000));
}

function toListItem(
  experiment: experimentRepo.ExperimentWithVariants,
  metrics: Map<string, Metric>,
  totals: ArmTotals[] | undefined,
  now: Date,
): ExperimentListItem {
  const arms = armsOf(experiment);
  const armTotals = arms.map(
    (arm) =>
      totals?.find((t) => t.position === arm.position) ?? { position: arm.position, v: 0, c: 0 },
  );
  return {
    id: experiment.id,
    projectId: experiment.websiteId,
    name: experiment.name,
    type: kindKey(experiment.type),
    status: statusKey(experiment.status),
    displayStatus: displayStatus(experiment.status, experiment.winnerPosition),
    url: experiment.controlUrl,
    path: pathOf(experiment.controlUrl),
    hypothesis: experiment.description ?? "",
    coverage: experiment.trafficAllocation,
    arms,
    goal: primaryGoalView(experiment, metrics),
    counting: countingKey(experiment.countingMode),
    winnerPosition: experiment.status === "ARCHIVED" ? experiment.winnerPosition : null,
    createdAt: experiment.createdAt.toISOString(),
    updatedAt: experiment.updatedAt.toISOString(),
    publishedAt: experiment.publishedAt?.toISOString() ?? null,
    stoppedAt: experiment.stoppedAt?.toISOString() ?? null,
    daysRunning: daysRunning(experiment, now),
    totals: armTotals,
    visitors: armTotals.reduce((sum, t) => sum + t.v, 0),
    conversions: armTotals.reduce((sum, t) => sum + t.c, 0),
  };
}

export interface ExperimentListFilters {
  status?: ExperimentStatusKey | "all";
  type?: ExperimentKind | "all";
  q?: string;
  /** `updated` (default) | `created` | `name` | `visitors` | `cr`. */
  sort?: "updated" | "created" | "name" | "visitors" | "cr";
}

/**
 * A project's experiments for the list (and dashboard), with all-time per-arm totals on each
 * experiment's primary goal. `q` matches name or URL, case-insensitively.
 */
export async function listForProject(
  actorUserId: string,
  projectId: string,
  filters: ExperimentListFilters = {},
  now: Date = new Date(),
): Promise<ExperimentListItem[]> {
  const project = await requireProject(actorUserId, projectId);
  const experiments = await experimentRepo.listExperimentsForProject(project.id, actorUserId, {
    ...(filters.status && filters.status !== "all"
      ? { status: statusFromKey(filters.status) }
      : {}),
    ...(filters.type && filters.type !== "all" ? { type: typeFromKind(filters.type) } : {}),
    ...(filters.q?.trim() ? { search: filters.q.trim() } : {}),
  });

  const [metrics, totals] = await Promise.all([
    metricsById(project.id, actorUserId),
    primaryTotalsFor(actorUserId, experiments),
  ]);

  const items = experiments.map((e) => toListItem(e, metrics, totals.get(e.id), now));
  const rate = (item: ExperimentListItem) =>
    item.visitors ? item.conversions / item.visitors : -1;
  const sorters: Record<string, (a: ExperimentListItem, b: ExperimentListItem) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
    visitors: (a, b) => b.visitors - a.visitors,
    cr: (a, b) => rate(b) - rate(a),
  };
  return items.sort(sorters[filters.sort ?? "updated"] ?? sorters["updated"]!);
}

/** Counts per status for the list's tabs (unfiltered). */
export async function countForProject(
  actorUserId: string,
  projectId: string,
): Promise<Record<ExperimentStatusKey | "all", number>> {
  const project = await requireProject(actorUserId, projectId);
  const rows = await db.experiment.groupBy({
    by: ["status"],
    where: { websiteId: project.id },
    _count: { _all: true },
  });
  const counts = { all: 0, draft: 0, running: 0, paused: 0, completed: 0 };
  for (const row of rows) {
    counts[statusKey(row.status)] += row._count._all;
    counts.all += row._count._all;
  }
  return counts;
}

/** Everything the detail page needs: arms with changes, targeting, goals, activity, share. */
export async function getExperimentDetail(
  actorUserId: string,
  projectId: string,
  experimentId: string,
  now: Date = new Date(),
): Promise<ExperimentDetail> {
  const experiment = await requireExperimentInProject(actorUserId, projectId, experimentId);
  const [metrics, totals, activities] = await Promise.all([
    metricsById(projectId, actorUserId),
    primaryTotalsFor(actorUserId, [experiment]),
    activityRepo.listActivities(experiment.id),
  ]);

  const base = toListItem(experiment, metrics, totals.get(experiment.id), now);
  const secondaryGoals = experiment.secondaryMetricIds.flatMap((id) => {
    const metric = metrics.get(id);
    return metric ? [metricGoalView(metric)] : [];
  });

  return {
    ...base,
    targeting: normalizeTargeting(experiment.targeting, experiment.controlUrl),
    secondaryMetricIds: [...experiment.secondaryMetricIds],
    secondaryGoals,
    keepWinner: experiment.keepWinner,
    locked: experiment.status !== "DRAFT",
    share: {
      token: experiment.shareToken,
      sharedAt: experiment.sharedAt?.toISOString() ?? null,
      url: experiment.shareToken
        ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/share/${encodeURIComponent(experiment.shareToken)}`
        : null,
    },
    activities: activities.map((row) => ({
      id: row.id,
      text: row.text,
      actorName: row.actorName,
      createdAt: row.createdAt.toISOString(),
    })),
    draftSource: draftSourceOf(experiment),
  };
}

/** The wizard's source for an existing experiment (feed to `draftFromExperiment`). */
export async function getExperimentDraftSource(
  actorUserId: string,
  projectId: string,
  experimentId: string,
) {
  const experiment = await requireExperimentInProject(actorUserId, projectId, experimentId);
  return draftSourceOf(experiment);
}

// -------------------------------------------------------------------------------------------
// Draft → database
// -------------------------------------------------------------------------------------------

interface DraftData {
  experiment: Omit<Prisma.ExperimentUncheckedCreateInput, "websiteId" | "status" | "variants">;
  variants: { id?: string; url: string; weight: number; changes: Prisma.InputJsonValue }[];
}

/**
 * Maps a structurally valid draft onto columns. Lenient by design — it is also what saving an
 * incomplete draft stores — so it never throws; the launch path validates before calling it.
 *
 * Metric references are filtered to the project's own metrics (`ownedMetrics`), so a draft can
 * never point a goal at another project's metric.
 */
function draftToData(draft: ExperimentDraftInput, ownedMetrics: Set<string>): DraftData {
  const type = typeFromKind(draft.type);
  const isAb = type === "AB";
  const controlUrl = draft.url.trim();
  const targeting = normalizeTargeting(draft.targeting, controlUrl);
  const [control, ...variants] = draft.arms;
  const goalMetricId =
    draft.goalMode === "event" && draft.goal && ownedMetrics.has(draft.goal) ? draft.goal : null;
  const conversionUrl = draft.goalMode === "url" ? draft.convUrl.trim() || null : null;

  return {
    experiment: {
      name: draft.name.trim() || UNTITLED,
      description: draft.hypothesis.trim() || null,
      type,
      controlUrl,
      // The page rule's simple forms map onto the legacy match column the config still reads;
      // contains/wildcard/regex live in `targeting` only.
      controlMatchType: targeting.match === "starts" ? "PREFIX" : "EXACT",
      controlWeight: control?.weight ?? 50,
      targeting: targeting as unknown as Prisma.InputJsonValue,
      trafficAllocation: draft.coverage,
      conversionUrl,
      conversionMatchType: matchFromKey(draft.convMatch),
      goalMetricId,
      secondaryMetricIds: [...new Set(draft.secondary)].filter(
        (id) => ownedMetrics.has(id) && id !== goalMetricId,
      ),
      countingMode: countingFromKey(draft.counting),
    },
    variants: variants.map((arm) => ({
      ...(arm.id ? { id: arm.id } : {}),
      url: isAb ? "" : arm.url.trim(),
      weight: arm.weight,
      changes: (isAb ? arm.changes : []) as unknown as Prisma.InputJsonValue,
    })),
  };
}

/** The parsed draft as the `ExperimentDraft` shape `validateDraft` expects. */
function asDraft(input: ExperimentDraftInput, projectId: string): ExperimentDraft {
  return {
    id: input.id ?? null,
    projectId,
    type: input.type,
    name: input.name,
    url: input.url,
    hypothesis: input.hypothesis,
    arms: input.arms.map((arm, index) => ({
      ...(arm.id ? { id: arm.id } : {}),
      name: armName(index),
      url: arm.url,
      weight: arm.weight,
      changes: arm.changes.map((change) => ({ ...change })),
    })),
    coverage: input.coverage,
    targeting: normalizeTargeting(input.targeting, input.url),
    goalMode: input.goalMode,
    goal: input.goal,
    convUrl: input.convUrl,
    convMatch: input.convMatch,
    secondary: input.secondary,
    counting: input.counting,
  };
}

function parseDraft(input: unknown, projectId: string): ExperimentDraftInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  return parseOrThrow(experimentDraftSchema, { ...raw, projectId }, "Check the experiment setup.");
}

/**
 * Everything that stops a draft launching: the wizard's own rules (`validateDraft`, so the
 * messages match what the form shows), then the rules only the server can check. Keyed by step.
 */
async function launchErrors(
  draft: ExperimentDraftInput,
  project: websiteRepo.WebsiteWithDomains,
  ownedMetrics: Set<string>,
  excludeExperimentId: string | undefined,
): Promise<DraftErrors> {
  const errors = validateDraft(asDraft(draft, project.id));
  const add = (step: WizardStepKey, key: string, message: string) => {
    (errors[step] ??= {})[key] ??= message;
  };

  const domains = projectDomains(project);
  const offDomain = `Must be a URL on ${domains.join(" or ")} (or a subdomain).`;
  const isAb = draft.type === "ab";

  if (draft.arms.length < 2) add("variants", "arms", "Add at least one variant.");
  if (draft.arms.length > MAX_ARMS) {
    add("variants", "arms", "An experiment can have at most 5 arms (Control + 4 variants).");
  }

  // Same-site: every URL the experiment touches must be on one of the project's domains.
  if (draft.url && !onProjectDomain(draft.url, domains)) add("basics", "url", offDomain);
  draft.arms.forEach((arm, index) => {
    if (index === 0) return;
    if (!isAb && arm.url && !onProjectDomain(arm.url, domains)) {
      add("variants", `v${index}`, offDomain);
    }
    if (isAb) {
      arm.changes.forEach((change) => {
        const parsed = changeSchema.safeParse(change);
        if (!parsed.success) {
          add(
            "variants",
            `v${index}`,
            `${armName(index)}: ${parsed.error.issues[0]?.message ?? "invalid change"}`,
          );
        }
      });
    }
  });

  if (draft.goalMode === "url") {
    if (draft.convUrl && !onProjectDomain(draft.convUrl, domains)) add("goal", "conv", offDomain);
  } else if (draft.goal && !ownedMetrics.has(draft.goal)) {
    add("goal", "goal", "Choose a metric from this project.");
  }
  if (draft.secondary.some((id) => !ownedMetrics.has(id))) {
    add("goal", "secondary", "Secondary goals must be metrics from this project.");
  }

  // One active experiment per page, against the page rule (targeting) rather than the bare URL.
  if (!errors.basics?.["url"] && !errors.targeting?.["pattern"]) {
    const candidate = {
      url: draft.url.trim(),
      targeting: normalizeTargeting(draft.targeting, draft.url.trim()),
    };
    const clash = await findActiveClash(project.id, candidate, excludeExperimentId);
    if (clash) {
      add(
        "targeting",
        "pattern",
        `“${clash.name}” is already running on this page. Pause or end it first, or narrow the targeting.`,
      );
    }
  }

  return errors;
}

async function findActiveClash(
  websiteId: string,
  candidate: { url: string; targeting: ReturnType<typeof normalizeTargeting> },
  excludeExperimentId?: string,
): Promise<Experiment | undefined> {
  const active = await experimentRepo.listActiveExperimentsExcluding(
    websiteId,
    excludeExperimentId,
  );
  return active.find((other) => pageRulesOverlap(candidate, pageRuleOf(other)));
}

function hasAnyError(errors: DraftErrors): boolean {
  return Object.values(errors).some((fields) => fields && Object.keys(fields).length > 0);
}

/** Writes a draft's data onto an existing experiment row and reconciles its variants. */
async function writeDraft(
  tx: Prisma.TransactionClient,
  experimentId: string,
  actorUserId: string,
  data: DraftData,
  extra: Prisma.ExperimentUncheckedUpdateManyInput = {},
): Promise<void> {
  const result = await experimentRepo.updateExperiment(
    experimentId,
    actorUserId,
    { ...(data.experiment as Prisma.ExperimentUncheckedUpdateManyInput), ...extra },
    tx,
  );
  if (result.count === 0) throw notFound("That experiment does not exist.");
  await experimentRepo.replaceVariants(experimentId, data.variants, tx);
}

async function createFromDraft(
  tx: Prisma.TransactionClient,
  websiteId: string,
  data: DraftData,
  status: ExperimentStatus,
): Promise<Experiment> {
  return experimentRepo.createExperiment(
    {
      ...data.experiment,
      websiteId,
      status,
      ...(status === "ACTIVE" ? { publishedAt: new Date() } : {}),
      variants: {
        create: data.variants.map((variant, index) => ({
          url: variant.url,
          weight: variant.weight,
          changes: variant.changes,
          position: index + 1,
        })),
      },
    },
    tx,
  );
}

/**
 * Creates or updates a DRAFT from the wizard. Lenient: an empty name becomes "Untitled
 * experiment", URLs may be blank or half-typed — only the structure is checked. Editing a
 * draft whose `id` is no longer a draft is refused (it has launched; its setup is fixed).
 */
export async function saveDraft(
  actorUserId: string,
  projectId: string,
  input: unknown,
): Promise<{ id: string }> {
  const project = await requireProject(actorUserId, projectId);
  const draft = parseDraft(input, project.id);
  const owned = await metricRepo.ownedMetricIds(project.id, [
    ...(draft.goal ? [draft.goal] : []),
    ...draft.secondary,
  ]);
  const data = draftToData(draft, owned);

  if (draft.id) {
    const existing = await requireExperimentInProject(actorUserId, project.id, draft.id);
    if (existing.status !== "DRAFT") {
      throw conflict("This experiment has already launched, so its setup can no longer be edited.");
    }
    await db.$transaction(async (tx) => {
      await writeDraft(tx, existing.id, actorUserId, data);
      await logActivity(existing.id, actorUserId, "Draft updated", tx);
    });
    return { id: existing.id };
  }

  const created = await db.$transaction(async (tx) => {
    const experiment = await createFromDraft(tx, project.id, data, "DRAFT");
    await logActivity(experiment.id, actorUserId, "Experiment created as draft", tx);
    return experiment;
  });
  return { id: created.id };
}

/**
 * Validates a draft completely and launches it: creates (or updates the existing draft) and sets
 * it ACTIVE with `publishedAt`. Field errors are keyed `step.field` — the wizard's own keys
 * (`basics.url`, `variants.v1`, `goal.conv`, `targeting.pattern`, …) — so the wizard can route
 * each to its step; server-only rules use the same keys (`variants.arms`, `goal.secondary`).
 */
export async function launch(
  actorUserId: string,
  projectId: string,
  input: unknown,
): Promise<{ id: string }> {
  const project = await requireProject(actorUserId, projectId);
  const draft = parseDraft(input, project.id);
  const owned = await metricRepo.ownedMetricIds(project.id, [
    ...(draft.goal ? [draft.goal] : []),
    ...draft.secondary,
  ]);

  const existing = draft.id
    ? await requireExperimentInProject(actorUserId, project.id, draft.id)
    : null;
  if (existing && existing.status !== "DRAFT") {
    throw conflict("This experiment has already launched.");
  }

  const errors = await launchErrors(draft, project, owned, existing?.id);
  if (hasAnyError(errors)) {
    throw validationFailed(
      "Fix the highlighted fields before launching.",
      flattenDraftErrors(errors),
    );
  }

  const data = draftToData(draft, owned);
  const launchedText = `Launched to ${draft.coverage}% of matching traffic`;

  const id = await db.$transaction(async (tx) => {
    if (existing) {
      await writeDraft(tx, existing.id, actorUserId, data, {
        status: "ACTIVE",
        ...(existing.publishedAt ? {} : { publishedAt: new Date() }),
      });
      await logActivity(existing.id, actorUserId, launchedText, tx);
      return existing.id;
    }
    const created = await createFromDraft(tx, project.id, data, "ACTIVE");
    await logActivity(created.id, actorUserId, "Experiment created", tx);
    await logActivity(created.id, actorUserId, launchedText, tx);
    return created.id;
  });

  return { id };
}

/** Running → paused. Visitors see control and nothing is collected while paused. */
export async function pause(
  actorUserId: string,
  projectId: string,
  experimentId: string,
): Promise<void> {
  const experiment = await requireExperimentInProject(actorUserId, projectId, experimentId);
  if (experiment.status !== "ACTIVE") throw conflict("Only a running experiment can be paused.");
  await db.$transaction(async (tx) => {
    await experimentRepo.updateExperiment(experiment.id, actorUserId, { status: "PAUSED" }, tx);
    await logActivity(experiment.id, actorUserId, "Experiment paused", tx);
  });
}

/** Paused → running, re-checking that no other running experiment has claimed the page since. */
export async function resume(
  actorUserId: string,
  projectId: string,
  experimentId: string,
): Promise<void> {
  const experiment = await requireExperimentInProject(actorUserId, projectId, experimentId);
  if (experiment.status !== "PAUSED") throw conflict("Only a paused experiment can be resumed.");

  const clash = await findActiveClash(experiment.websiteId, pageRuleOf(experiment), experiment.id);
  if (clash) {
    throw conflict(
      `“${clash.name}” is now running on this page. Pause or end it before resuming this one.`,
    );
  }

  await db.$transaction(async (tx) => {
    await experimentRepo.updateExperiment(experiment.id, actorUserId, { status: "ACTIVE" }, tx);
    await logActivity(experiment.id, actorUserId, "Experiment resumed", tx);
  });
}

/**
 * Ends a running or paused experiment (→ completed). `winnerPosition`: 0 = control,
 * n = variant n, null = no winner. `keepWinner` (keep redirecting all traffic to the winning
 * URL) applies only to a Split URL test with a variant winner, and is ignored otherwise.
 */
export async function end(actorUserId: string, input: unknown): Promise<void> {
  const { projectId, experimentId, winnerPosition, keepWinner } = parseOrThrow(
    endExperimentSchema,
    input,
  );
  const experiment = await requireExperimentInProject(actorUserId, projectId, experimentId);
  if (experiment.status !== "ACTIVE" && experiment.status !== "PAUSED") {
    throw conflict("Only a running or paused experiment can be ended.");
  }
  if (winnerPosition !== null && winnerPosition > experiment.variants.length) {
    throw validationFailed("Choose one of this experiment’s arms.", {
      winnerPosition: ["Choose one of this experiment’s arms."],
    });
  }

  const keep = keepWinner && experiment.type === "SPLIT_URL" && (winnerPosition ?? 0) > 0;
  const text =
    winnerPosition === null
      ? "Ended with no winner"
      : `Ended · ${armName(winnerPosition)} declared winner${keep ? " · 100% redirected to winner" : ""}`;

  await db.$transaction(async (tx) => {
    await experimentRepo.updateExperiment(
      experiment.id,
      actorUserId,
      { status: "ARCHIVED", stoppedAt: new Date(), winnerPosition, keepWinner: keep },
      tx,
    );
    await logActivity(experiment.id, actorUserId, text, tx);
  });
}

/** Copies an experiment's setup into a new DRAFT named "Copy of …". Results are not copied. */
export async function duplicate(
  actorUserId: string,
  projectId: string,
  experimentId: string,
): Promise<{ id: string }> {
  const source = await requireExperimentInProject(actorUserId, projectId, experimentId);
  const name = `Copy of ${source.name}`.slice(0, 120);

  const created = await db.$transaction(async (tx) => {
    const experiment = await experimentRepo.createExperiment(
      {
        websiteId: source.websiteId,
        name,
        description: source.description,
        type: source.type,
        controlUrl: source.controlUrl,
        controlMatchType: source.controlMatchType,
        controlWeight: source.controlWeight,
        targeting: (source.targeting ?? undefined) as Prisma.InputJsonValue | undefined,
        trafficAllocation: source.trafficAllocation,
        conversionName: source.conversionName,
        conversionUrl: source.conversionUrl,
        conversionMatchType: source.conversionMatchType,
        goalMetricId: source.goalMetricId,
        secondaryMetricIds: [...source.secondaryMetricIds],
        countingMode: source.countingMode,
        primaryMetric: source.primaryMetric,
        status: "DRAFT",
        variants: {
          create: source.variants.map((variant) => ({
            url: variant.url,
            weight: variant.weight,
            position: variant.position,
            changes: (variant.changes ?? []) as Prisma.InputJsonValue,
          })),
        },
      },
      tx,
    );
    await logActivity(experiment.id, actorUserId, `Duplicated from “${source.name}”`, tx);
    return experiment;
  });

  return { id: created.id };
}

/** Deletes a draft or completed experiment. Running/paused ones must be ended first. */
export async function remove(
  actorUserId: string,
  projectId: string,
  experimentId: string,
): Promise<void> {
  const experiment = await requireExperimentInProject(actorUserId, projectId, experimentId);
  if (experiment.status === "ACTIVE" || experiment.status === "PAUSED") {
    throw conflict("End this experiment before deleting it.");
  }
  const result = await experimentRepo.deleteExperiment(experiment.id, actorUserId);
  if (result.count === 0) throw notFound("That experiment does not exist.");
}

/**
 * Edits allowed after launch: name, hypothesis, traffic weights (same arm count, sum 100),
 * coverage, secondary goals, counting mode. URLs, changes, targeting and the primary goal are
 * fixed once visitors have been bucketed against them. Drafts are edited with `saveDraft`.
 */
export async function editLive(actorUserId: string, input: unknown): Promise<void> {
  const data = parseOrThrow(editLiveExperimentSchema, input, "Check the changes.");
  const experiment = await requireExperimentInProject(
    actorUserId,
    data.projectId,
    data.experimentId,
  );
  if (experiment.status === "DRAFT") {
    throw conflict("Drafts are edited in the setup wizard.");
  }

  const update: Prisma.ExperimentUncheckedUpdateManyInput = {};
  const changed: string[] = [];

  if (data.name !== undefined && data.name !== experiment.name) {
    update.name = data.name;
    changed.push("name");
  }
  if (data.hypothesis !== undefined && data.hypothesis !== (experiment.description ?? "")) {
    update.description = data.hypothesis || null;
    changed.push("hypothesis");
  }
  if (data.coverage !== undefined && data.coverage !== experiment.trafficAllocation) {
    update.trafficAllocation = data.coverage;
    changed.push(`coverage → ${data.coverage}%`);
  }
  if (data.counting !== undefined) {
    const mode = countingFromKey(data.counting);
    if (mode !== experiment.countingMode) {
      update.countingMode = mode;
      changed.push("counting");
    }
  }
  if (data.secondary !== undefined) {
    const owned = await metricRepo.ownedMetricIds(experiment.websiteId, data.secondary);
    if (data.secondary.some((id) => !owned.has(id))) {
      throw validationFailed("Secondary goals must be metrics from this project.", {
        "goal.secondary": ["Secondary goals must be metrics from this project."],
      });
    }
    update.secondaryMetricIds = [...new Set(data.secondary)].filter(
      (id) => id !== experiment.goalMetricId,
    );
    changed.push("secondary goals");
  }

  let weights: number[] | undefined;
  if (data.weights !== undefined) {
    if (data.weights.length !== experiment.variants.length + 1) {
      throw validationFailed("Arms can’t be added or removed after launch.", {
        "traffic.sum": ["Arms can’t be added or removed after launch."],
      });
    }
    const sum = data.weights.reduce((total, weight) => total + weight, 0);
    if (sum !== 100) {
      throw validationFailed(`Allocation adds up to ${sum}%. It must equal 100%.`, {
        "traffic.sum": [`Allocation adds up to ${sum}%. It must equal 100%.`],
      });
    }
    weights = data.weights;
    update.controlWeight = weights[0]!;
    changed.push(`traffic split → ${weights.join(" / ")}`);
  }

  if (changed.length === 0) return;

  await db.$transaction(async (tx) => {
    await experimentRepo.updateExperiment(experiment.id, actorUserId, update, tx);
    if (weights) {
      for (const variant of experiment.variants) {
        await tx.experimentVariant.update({
          where: { id: variant.id },
          data: { weight: weights[variant.position] ?? variant.weight },
        });
      }
    }
    await logActivity(experiment.id, actorUserId, `Edited: ${changed.join(", ")}`, tx);
  });
}

/** Share-link functions, checked against the project as well as the owner. */
export async function setSharing(
  actorUserId: string,
  projectId: string,
  experimentId: string,
  mode: "enable" | "rotate" | "disable",
): Promise<{ token: string | null; url: string | null }> {
  await requireExperimentInProject(actorUserId, projectId, experimentId);
  const updated =
    mode === "enable"
      ? await enableSharing(actorUserId, experimentId)
      : mode === "rotate"
        ? await rotateShareToken(actorUserId, experimentId)
        : await disableSharing(actorUserId, experimentId);
  return {
    token: updated.shareToken,
    url: updated.shareToken
      ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/share/${encodeURIComponent(updated.shareToken)}`
      : null,
  };
}

// ===========================================================================================
// Unscoped lookups and share-link primitives (legacy redirect pages, setSharing, /share)
// ===========================================================================================

export async function getExperiment(
  actorUserId: string,
  experimentId: string,
): Promise<experimentRepo.ExperimentWithWebsite> {
  const experiment = await experimentRepo.findExperimentForUser(experimentId, actorUserId);

  if (!experiment) {
    throw notFound("That experiment does not exist.");
  }

  return experiment;
}

/**
 * Public results sharing.
 *
 * A share link is an unguessable token, not an access grant: anyone holding it can read one
 * experiment's numbers and nothing else — no account, no website, no other experiment. That is
 * the whole security model, so the token has to be genuinely unguessable and revocation has to
 * be immediate.
 */

/** 192 bits from a CSPRNG. Long enough that enumeration is not a threat worth modelling. */
const SHARE_TOKEN_BYTES = 24;

function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/**
 * Turns sharing on, or returns the existing link.
 *
 * Idempotent on purpose: clicking "share" twice should hand back the same URL rather than
 * quietly invalidating the one already sent to somebody.
 */
export async function enableSharing(
  actorUserId: string,
  experimentId: string,
): Promise<Experiment> {
  const existing = await getExperiment(actorUserId, experimentId);
  if (existing.shareToken) return existing;

  await experimentRepo.updateExperiment(experimentId, actorUserId, {
    shareToken: generateShareToken(),
    sharedAt: new Date(),
  });

  return getExperiment(actorUserId, experimentId);
}

/**
 * Issues a new token, invalidating the previous link immediately.
 *
 * Separate from disabling because they answer different questions: "this link got out" versus
 * "I no longer want this shared at all".
 */
export async function rotateShareToken(
  actorUserId: string,
  experimentId: string,
): Promise<Experiment> {
  await getExperiment(actorUserId, experimentId);

  await experimentRepo.updateExperiment(experimentId, actorUserId, {
    shareToken: generateShareToken(),
    sharedAt: new Date(),
  });

  return getExperiment(actorUserId, experimentId);
}

/** Turns sharing off. Clearing the token *is* the revocation — there is no second flag to miss. */
export async function disableSharing(
  actorUserId: string,
  experimentId: string,
): Promise<Experiment> {
  await getExperiment(actorUserId, experimentId);

  await experimentRepo.updateExperiment(experimentId, actorUserId, {
    shareToken: null,
    sharedAt: null,
  });

  return getExperiment(actorUserId, experimentId);
}

/**
 * Resolves a shared experiment from its token, for the public results page.
 *
 * Deliberately takes no actor: the token is the authorization. Returns null for an unknown or
 * revoked token, which the route renders as a plain 404 — telling a stranger the difference
 * between "never existed" and "was revoked" is information they have no need for.
 */
export function findSharedExperiment(
  shareToken: string,
): Promise<experimentRepo.ExperimentWithWebsite | null> {
  return experimentRepo.findExperimentByShareToken(shareToken);
}
