import "server-only";

import { randomBytes } from "node:crypto";

import type {
  Experiment,
  DeviceType,
  ExperimentStatus,
  ExperimentType,
  MemberRole,
  Prisma,
  Website,
} from "@/generated/prisma/client";
import {
  type LaunchIssue,
  type LaunchRuleExperiment,
  normalizeDevices,
  pageKey,
  setupIssues,
  shortUrl,
  withScheme,
} from "@/lib/launch-rules";
import {
  type Capability,
  can,
  canDeleteExperiment,
  rolesThatCanDeleteExperiment,
  rolesWith,
} from "@/lib/permissions";
import { TRACKING_CHECK_MAX_AGE_MS } from "@/lib/tracking-check";
import { analyzeResults, winnerBasis } from "@/lib/verdict";
import { controlUrlsConflict, isSameSite } from "@/lib/url";
import { pageBaseline } from "@/lib/visitors";
import { type DbClient, db } from "@/server/db";
import {
  AppError,
  conflict,
  forbidden,
  notFound,
  rateLimited,
  validationFailed,
} from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import * as activityRepo from "@/server/repositories/activity.repository";
import * as assignmentRepo from "@/server/repositories/assignment.repository";
import * as conversionRepo from "@/server/repositories/conversion.repository";
import * as draftRepo from "@/server/repositories/experiment-draft.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { notify } from "@/server/services/notification.service";
import {
  type UrlCheck,
  checkExperimentTracking,
  checkUrlsForWebsite,
  experimentTrackingUrls,
} from "@/server/services/tracking-check.service";
import { parseOrThrow } from "@/server/validate";
import {
  type DraftPatch,
  type DraftVariantInput,
  type ExperimentVariantInput,
  PAUSED_EDIT_LOCKED_MESSAGE,
  type PausedEdit,
  changeExperimentStatusSchema,
  chooseWinnerSchema,
  createDraftSchema,
  createExperimentSchema,
  draftPatchSchema,
  pausedEditSchema,
  updateExperimentSchema,
} from "@/validation/experiment";
import { toStoredChanges } from "@/validation/visual-change";

/**
 * Experiment business logic.
 *
 * As with websites, `actorUserId` is threaded into every query — here through the parent
 * website's workspace membership — so tenancy is enforced in the same statement that reads or
 * writes. A non-member gets NOT_FOUND; a member whose role lacks the capability gets FORBIDDEN,
 * and every write also carries the allowed roles in its own filter.
 *
 * Two rules live here rather than in the Zod schemas, because both need data the schema
 * cannot see: the same-site rule needs the website's domain, and the conflict rule needs the
 * website's other experiments.
 */

/**
 * Permitted status transitions.
 *
 * Modelling this as data rather than a chain of `if`s means the rules are visible in one
 * place and the UI can derive which buttons to show from the same table. COMPLETED is
 * terminal: a completed experiment keeps its collected data but can never collect more. A draft
 * is deleted rather than completed — it has nothing to keep.
 */
const ALLOWED_TRANSITIONS: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  DRAFT: ["ACTIVE"],
  ACTIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["ACTIVE", "COMPLETED"],
  COMPLETED: [],
};

const EDIT_ROLES = rolesWith("experiment.edit");
const SHARE_ROLES = rolesWith("share.manage");

export function listExperiments(actorUserId: string, websiteId: string): Promise<Experiment[]> {
  return experimentRepo.listExperimentsForWebsite(websiteId, actorUserId);
}

/** Every experiment in the actor's workspace, filtered, for the experiments list page. */
export function listAllExperiments(
  actorUserId: string,
  workspaceId: string,
  query: experimentRepo.ExperimentQuery = {},
): Promise<experimentRepo.ExperimentWithWebsite[]> {
  return experimentRepo.listExperimentsInWorkspace(workspaceId, actorUserId, query);
}

export function countByStatus(actorUserId: string, workspaceId: string) {
  return experimentRepo.countExperimentsByStatus(workspaceId, actorUserId);
}

export async function getExperiment(
  actorUserId: string,
  experimentId: string,
): Promise<experimentRepo.ExperimentWithWebsite> {
  return (await getExperimentAccess(actorUserId, experimentId)).experiment;
}

/**
 * An experiment and the actor's role in its workspace. NOT_FOUND for a non-member; with
 * `capability`, FORBIDDEN for a member whose role lacks it.
 */
export async function getExperimentAccess(
  actorUserId: string,
  experimentId: string,
  capability?: Capability,
): Promise<{ experiment: experimentRepo.ExperimentWithWebsite; role: MemberRole }> {
  const access = await experimentRepo.findExperimentAccess(experimentId, actorUserId);

  if (!access) {
    throw notFound("That experiment does not exist.");
  }

  if (capability && !can(access.role, capability)) {
    throw forbidden();
  }

  return access;
}

/**
 * Every experiment URL must live on the website it belongs to.
 *
 * Without this, an experiment could redirect a website's visitors to an unrelated domain —
 * the customer's own visitors, sent somewhere they never agreed to. It also prevents the
 * quieter mistake of pointing at a staging host and wondering why nothing is recorded.
 *
 * The conversion URL is held to the same rule: conversions are attributed by the snippet
 * running on the goal page, and that snippet belongs to this website. A goal on a different
 * domain could never record anything, so accepting it would only produce a silent dud. Every
 * variant's redirect target is held to it for the same reason as the control URL.
 */
function assertSameSite(
  website: Pick<Website, "domain">,
  urls: { controlUrl: string; variants: ExperimentVariantInput[]; conversionUrl: string },
): void {
  const offenders: Record<string, string[]> = {};
  const onSite = (url: string) => isSameSite(url, website.domain);
  const message = `Must be a URL on ${website.domain} or one of its subdomains.`;

  if (!onSite(urls.controlUrl)) offenders["controlUrl"] = [message];
  if (!onSite(urls.conversionUrl)) offenders["conversionUrl"] = [message];

  urls.variants.forEach((variant, index) => {
    if (!onSite(variant.url)) {
      offenders[`variants.${index}.url`] = [message];
    }
  });

  if (Object.keys(offenders).length > 0) {
    throw validationFailed(
      `Experiment URLs must be on ${website.domain}, the domain this website is configured for.`,
      offenders,
    );
  }
}

/**
 * Refuses a control URL already claimed by another active experiment on the same website.
 *
 * Two active experiments matching the same page would each try to bucket and redirect the
 * same visitor, and the winner would come down to evaluation order — producing results that
 * silently mix two tests. Checked at creation and at edit so the problem surfaces while the
 * experiment is still a draft, and again on activation, which is the moment it becomes real.
 */
async function assertNoActiveConflict(
  websiteId: string,
  candidate: { url: string; match: Experiment["controlMatchType"] },
  excludeExperimentId?: string,
): Promise<void> {
  const active = await experimentRepo.listActiveExperimentsExcluding(
    websiteId,
    excludeExperimentId,
  );

  const clash = active.find(
    (other) =>
      other.controlUrl !== null &&
      controlUrlsConflict(candidate, { url: other.controlUrl, match: other.controlMatchType }),
  );

  if (clash) {
    throw validationFailed(
      `“${clash.name}” is already running on that control URL. Pause or end it before starting another test on the same page.`,
      { controlUrl: ["Another active experiment already targets this page."] },
    );
  }
}

export async function createExperiment(actorUserId: string, input: unknown): Promise<Experiment> {
  const data = parseOrThrow(createExperimentSchema, input, "Check the experiment setup.");

  // The website must be in one of the actor's workspaces, and they must be allowed to create
  // experiments there; otherwise an experiment could be attached to someone else's website by
  // supplying its id.
  const access = await websiteRepo.findWebsiteAccess(data.websiteId, actorUserId);
  if (!access) {
    throw notFound("That website does not exist.");
  }
  if (!can(access.role, "experiment.edit")) {
    throw forbidden();
  }
  const { website } = access;

  assertSameSite(website, data);
  await assertNoActiveConflict(website.id, {
    url: data.controlUrl,
    match: data.controlMatchType,
  });

  const createData = {
    websiteId: website.id,
    name: data.name,
    description: data.description ?? null,
    controlUrl: data.controlUrl,
    controlMatchType: data.controlMatchType,
    conversionUrl: data.conversionUrl,
    conversionMatchType: data.conversionMatchType,
    primaryMetric: data.primaryMetric,
    trafficAllocation: data.trafficAllocation,
    controlWeight: data.controlWeight,
    // Experiments always begin as drafts: nothing is redirected until someone activates it.
    status: "DRAFT",
    type: "SPLIT_URL",
    createdById: actorUserId,
    variants: {
      create: data.variants.map((variant, index) => ({
        url: variant.url,
        weight: variant.weight,
        position: index + 1,
        colorIndex: (index % 4) + 1,
        name: experimentRepo.defaultVariantName(index + 1),
      })),
    },
  } satisfies Prisma.ExperimentUncheckedCreateInput;

  return db.$transaction(async (tx) => {
    const experiment = await experimentRepo.createExperiment(createData, tx);
    await activityRepo.createActivity(
      { experimentId: experiment.id, type: "CREATED", actorId: actorUserId },
      tx,
    );
    return experiment;
  });
}

/**
 * Applies changes to an experiment.
 *
 * The caller may send a partial update, but the URL rules only make sense against the
 * complete configuration, so the stored record is merged with the changes before validation.
 * Editing the targets of a running experiment is rejected: existing visitors are already
 * bucketed against the old configuration, and mixing both under one experiment id would
 * silently corrupt the comparison. That lock covers the whole variant set, not just each
 * URL's text — adding or removing an arm after visitors are already bucketed against the old
 * set would be the same corruption by another route.
 *
 * **Traffic weights are deliberately outside that lock.** Re-weighting only changes the odds
 * for visitors who have not been bucketed yet; every existing assignment is permanent, so no
 * already-collected result changes meaning. Being able to shift traffic — or park an arm at 0
 * — while a test runs is the point of having weights at all.
 */
export async function updateExperiment(
  actorUserId: string,
  experimentId: string,
  changes: Record<string, unknown>,
): Promise<Experiment> {
  const { experiment: existing } = await getExperimentAccess(
    actorUserId,
    experimentId,
    "experiment.edit",
  );

  // Spreading a key whose value is `undefined` still overwrites — `{a: 1, ...{a: undefined}}`
  // is `{a: undefined}` — so "not submitted" has to be dropped before the merge rather than
  // relied on to fall through to the stored value.
  const supplied = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  );

  const merged = parseOrThrow(
    updateExperimentSchema,
    {
      experimentId,
      name: existing.name,
      description: existing.description ?? undefined,
      // A draft started in the new wizard may not have its URLs yet; passing `undefined` lets the
      // schema report them as required rather than as malformed.
      controlUrl: existing.controlUrl ?? undefined,
      controlMatchType: existing.controlMatchType,
      controlWeight: existing.controlWeight,
      variants: existing.variants.map((variant) => ({
        id: variant.id,
        url: variant.url ?? undefined,
        weight: variant.weight,
      })),
      conversionName: existing.conversionName ?? undefined,
      conversionUrl: existing.conversionUrl ?? undefined,
      conversionMatchType: existing.conversionMatchType,
      primaryMetric: existing.primaryMetric,
      trafficAllocation: existing.trafficAllocation,
      ...supplied,
    },
    "Check the experiment setup.",
  );

  // Structure — which arms exist and where they point — is what the running-experiment lock
  // guards. Weight is compared separately below, because it is allowed to change at any time.
  const variantsStructurallyChanged =
    merged.variants.length !== existing.variants.length ||
    merged.variants.some(
      (variant, index) =>
        variant.id !== existing.variants[index]?.id ||
        variant.url !== existing.variants[index]?.url,
    );

  const variantsChanged =
    variantsStructurallyChanged ||
    merged.variants.some((variant, index) => variant.weight !== existing.variants[index]?.weight);

  const targetsChanged =
    merged.controlUrl !== existing.controlUrl ||
    merged.conversionUrl !== existing.conversionUrl ||
    merged.controlMatchType !== existing.controlMatchType ||
    merged.conversionMatchType !== existing.conversionMatchType ||
    variantsStructurallyChanged;

  if (targetsChanged && existing.status !== "DRAFT") {
    throw validationFailed(
      "This experiment has already started, so its URLs are fixed. End it and create a new one to test different pages.",
    );
  }

  assertSameSite(existing.website, merged);

  if (targetsChanged) {
    await assertNoActiveConflict(
      existing.websiteId,
      { url: merged.controlUrl, match: merged.controlMatchType },
      experimentId,
    );
  }

  const { experimentId: _id, variants, ...data } = merged;

  await db.$transaction(async (tx) => {
    const result = await experimentRepo.updateExperiment(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      {
        ...data,
        description: data.description ?? null,
        conversionName: data.conversionName ?? null,
      },
      tx,
    );

    if (result.count === 0) {
      throw notFound("That experiment does not exist.");
    }

    if (variantsChanged) {
      await experimentRepo.replaceVariants(experimentId, variants, tx);
    }
  });

  return getExperiment(actorUserId, experimentId);
}

/**
 * Moves an experiment through its lifecycle — the pre-design pages' single status control.
 *
 * Delegates to the lifecycle functions below, so the old controls get the same rules as the new
 * screens (launch validation and tracking check, the conflict re-check, activity rows, the pause
 * notification) rather than a second, weaker path to the same transitions.
 */
export async function changeStatus(actorUserId: string, input: unknown): Promise<Experiment> {
  const { experimentId, status } = parseOrThrow(changeExperimentStatusSchema, input);
  const { experiment: existing } = await getExperimentAccess(
    actorUserId,
    experimentId,
    "experiment.edit",
  );

  if (existing.status === status) {
    return existing;
  }

  if (!ALLOWED_TRANSITIONS[existing.status].includes(status)) {
    throw conflict(`An experiment cannot go from ${existing.status} to ${status}.`);
  }

  if (status === "ACTIVE") {
    await (existing.status === "DRAFT"
      ? launchExperiment(actorUserId, experimentId)
      : resumeExperiment(actorUserId, experimentId));
  } else if (status === "PAUSED") {
    await pauseExperiment(actorUserId, experimentId);
  } else if (status === "COMPLETED") {
    await endExperiment(actorUserId, experimentId);
  }

  return getExperiment(actorUserId, experimentId);
}

/** Admins and the Owner may delete any experiment; an Editor only a draft. */
export async function deleteExperiment(
  actorUserId: string,
  experimentId: string,
): Promise<{ experimentId: string; websiteId: string }> {
  const { experiment, role } = await getExperimentAccess(actorUserId, experimentId);

  if (!canDeleteExperiment(role, experiment.status)) {
    throw forbidden();
  }

  const result = await experimentRepo.deleteExperiment(
    experimentId,
    actorUserId,
    rolesThatCanDeleteExperiment(experiment.status),
    experiment.status,
  );

  if (result.count === 0) {
    throw notFound("That experiment does not exist.");
  }
  return { experimentId, websiteId: experiment.websiteId };
}

/** Status values an experiment may currently move to. Drives which controls the UI offers. */
export function allowedTransitions(status: ExperimentStatus): readonly ExperimentStatus[] {
  return ALLOWED_TRANSITIONS[status];
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
  const { experiment: existing } = await getExperimentAccess(
    actorUserId,
    experimentId,
    "share.manage",
  );
  if (existing.shareToken) return existing;

  await experimentRepo.updateExperiment(experimentId, actorUserId, SHARE_ROLES, {
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
  await getExperimentAccess(actorUserId, experimentId, "share.manage");

  await experimentRepo.updateExperiment(experimentId, actorUserId, SHARE_ROLES, {
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
  await getExperimentAccess(actorUserId, experimentId, "share.manage");

  await experimentRepo.updateExperiment(experimentId, actorUserId, SHARE_ROLES, {
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

// =============================================================================================
// The new-design wizards and lifecycle (spec §2.7, §2.8, §3).
//
//   createDraft ─► saveDraft (lenient, as the customer types) ─► launchExperiment
//                                                         ACTIVE ◄─► PAUSED ─► COMPLETED
//
// Every transition is one transaction: the status write — filtered on the status it is allowed
// from, the actor's role and, for launch, the draft not having changed since it was validated —
// plus its `ExperimentActivity` row. The rules that decide whether a draft can launch live in
// `lib/launch-rules.ts` (pure, shared with the wizards and the project dashboard); this file adds
// the ones that need the database: one running experiment per page, and the tracking check.
// =============================================================================================

export type ExperimentTypeName = ExperimentType;

/** What every draft write returns to the wizard. */
export interface DraftSaveResult {
  id: string;
  type: ExperimentType;
  /** The wizard's "Draft saved …" label. */
  updatedAt: Date;
  /** Every submitted variant row: the wizard's key → the stored id (new rows included). */
  variants: { key: string; id: string }[];
  /** Visitors a day to the tested page over 30 days, for the traffic estimates; null = none. */
  baseline: number | null;
}

export interface LifecycleResult {
  experimentId: string;
  websiteId: string;
  status: ExperimentStatus;
}

/** "Another running experiment already tests this page." — the conflict rule, as a step issue. */
export const CONFLICT_MESSAGE =
  "Another running experiment already tests this page. Pause it first.";

/**
 * A launch or resume refused by a rule rather than a fault: carries the step issues (shown on
 * the step they belong to) and/or the tracking results (shown in the tracking card), so the
 * wizard can put each where the design puts it.
 */
export class LaunchBlockedError extends AppError {
  readonly issues: LaunchIssue[] | undefined;
  readonly tracking: TrackingSummary | undefined;

  constructor(message: string, details: { issues?: LaunchIssue[]; tracking?: TrackingSummary }) {
    super("VALIDATION", message);
    this.name = "LaunchBlockedError";
    this.issues = details.issues;
    this.tracking = details.tracking;
  }
}

/** A tracking check, reduced to what crosses to the browser. */
export interface TrackingSummary {
  allOk: boolean;
  checks: {
    url: string;
    urlKey: string | null;
    result: "OK" | "MISSING" | "ERROR";
    method: "html" | "seen" | null;
    detail: string | null;
    checkedAt: Date;
  }[];
}

function summarizeChecks(checks: readonly UrlCheck[]): TrackingSummary {
  return {
    allOk: checks.length > 0 && checks.every((check) => check.result === "OK"),
    checks: checks.map((check) => ({
      url: check.url,
      urlKey: check.urlKey,
      result: check.result,
      method: check.method,
      detail: check.detail,
      checkedAt: check.checkedAt,
    })),
  };
}

/** How a draft stores a URL: trimmed, with a scheme (so nothing stored is a `javascript:` link). */
function storedUrl(value: string | null | undefined): string | null {
  const url = withScheme(value ?? "");
  return url === "" ? null : url;
}

/** An experiment row as the pure launch rules read it. */
export function toRuleExperiment(
  experiment: experimentRepo.ExperimentWithVariants,
): LaunchRuleExperiment {
  return {
    type: experiment.type,
    name: experiment.name,
    controlUrl: experiment.controlUrl,
    conversionUrl: experiment.conversionUrl,
    controlWeight: experiment.controlWeight,
    trafficAllocation: experiment.trafficAllocation,
    targetDevices: experiment.targetDevices,
    variants: experiment.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      url: variant.url,
      weight: variant.weight,
      changes: variant.changes,
    })),
  };
}

async function baselineFor(websiteId: string, controlUrl: string | null): Promise<number | null> {
  if (!controlUrl || !pageKey(controlUrl)) return null;
  return pageBaseline(websiteId, withScheme(controlUrl));
}

/** Why a draft write matched nothing, worded for the status it is actually in. */
function lockedMessage(status: ExperimentStatus): string {
  if (status === "PAUSED") return PAUSED_EDIT_LOCKED_MESSAGE;
  if (status === "COMPLETED") return "This experiment has ended, so its setup can’t change.";
  return "This experiment is live, so its setup can’t change. Pause it to change its name or traffic.";
}

/** The website a wizard creates its draft in: the one asked for, else the workspace's newest. */
export async function resolveWizardWebsite(
  actorUserId: string,
  workspaceId: string,
  requestedWebsiteId?: string,
): Promise<{ website: Website; role: MemberRole } | null> {
  if (requestedWebsiteId) {
    const access = await websiteRepo.findWebsiteAccess(requestedWebsiteId, actorUserId);
    if (access) return access;
  }
  const [newest] = await websiteRepo.listWebsitesInWorkspace(workspaceId, actorUserId);
  if (!newest) return null;
  return websiteRepo.findWebsiteAccess(newest.id, actorUserId);
}

/** A draft and everything its wizard needs to reopen it. Any member may read it. */
export async function getWizardDraft(
  actorUserId: string,
  experimentId: string,
): Promise<{
  experiment: experimentRepo.ExperimentWithWebsite;
  role: MemberRole;
  baseline: number | null;
}> {
  const access = await getExperimentAccess(actorUserId, experimentId);
  return {
    ...access,
    baseline: await baselineFor(access.experiment.websiteId, access.experiment.controlUrl),
  };
}

/** The experiment-level fields of a patch, as stored — plain values, valid for create and update. */
function draftFields(
  patch: DraftPatch,
): Pick<
  Prisma.ExperimentUncheckedCreateInput,
  | "name"
  | "controlUrl"
  | "conversionUrl"
  | "keepQueryParams"
  | "trafficAllocation"
  | "controlWeight"
  | "wizardStep"
> & { targetDevices?: DeviceType[] } {
  return {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.controlUrl !== undefined ? { controlUrl: storedUrl(patch.controlUrl) } : {}),
    ...(patch.conversionUrl !== undefined ? { conversionUrl: storedUrl(patch.conversionUrl) } : {}),
    ...(patch.keepQueryParams !== undefined ? { keepQueryParams: patch.keepQueryParams } : {}),
    ...(patch.trafficAllocation !== undefined
      ? { trafficAllocation: patch.trafficAllocation }
      : {}),
    ...(patch.controlWeight !== undefined ? { controlWeight: patch.controlWeight } : {}),
    ...(patch.targetDevices !== undefined
      ? { targetDevices: normalizeDevices(patch.targetDevices) }
      : {}),
    ...(patch.wizardStep !== undefined ? { wizardStep: patch.wizardStep } : {}),
  };
}

/**
 * Makes the stored variants match the submitted list: rows left out are deleted, rows with an
 * id updated, rows without one created. An id that is not one of this experiment's variants is
 * refused — ids in a request only *name* rows, they never grant access to one.
 */
async function reconcileVariants(
  experimentId: string,
  type: ExperimentType,
  submitted: readonly DraftVariantInput[],
  tx: DbClient,
): Promise<{ key: string; id: string }[]> {
  const existing = new Set(await draftRepo.listVariantIds(experimentId, tx));
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const variant of submitted) {
    if (keys.has(variant.key)) throw validationFailed("Two variants share a key.");
    keys.add(variant.key);
    if (variant.id) {
      if (!existing.has(variant.id) || ids.has(variant.id)) {
        throw validationFailed("That variant no longer exists. Reload the page and try again.");
      }
      ids.add(variant.id);
    }
  }

  const removed = [...existing].filter((id) => !ids.has(id));
  if (removed.length > 0) await draftRepo.deleteVariants(experimentId, removed, tx);

  const usedSlots = new Set(
    submitted.flatMap((variant) => (variant.colorIndex ? [variant.colorIndex] : [])),
  );
  const mapping: { key: string; id: string }[] = [];

  for (const [index, variant] of submitted.entries()) {
    const position = index + 1;
    const common = {
      name: variant.name.trim(),
      weight: variant.weight,
      position,
      ...(type === "SPLIT_URL" && variant.url !== undefined ? { url: storedUrl(variant.url) } : {}),
      ...(type === "AB_TEST" && variant.changes !== undefined
        ? { changes: toStoredChanges(variant.changes) }
        : {}),
    };

    if (variant.id) {
      await draftRepo.updateVariant(
        experimentId,
        variant.id,
        { ...common, ...(variant.colorIndex ? { colorIndex: variant.colorIndex } : {}) },
        tx,
      );
      mapping.push({ key: variant.key, id: variant.id });
    } else {
      const colorIndex = variant.colorIndex ?? experimentRepo.firstFreeSlot(usedSlots, position);
      usedSlots.add(colorIndex);
      const created = await draftRepo.createVariant(
        {
          experimentId,
          ...common,
          colorIndex,
          ...(type === "AB_TEST" && variant.changes === undefined
            ? { changes: toStoredChanges([]) }
            : {}),
        },
        tx,
      );
      mapping.push({ key: variant.key, id: created.id });
    }
  }

  return mapping;
}

/**
 * Starts a draft in one of the actor's websites (spec §2.7 "First field edit"): one variant
 * "Variant A", an even split, every visitor and device, and a CREATED activity row. The wizard
 * calls this lazily, with its first edit as `patch`, so opening a wizard and leaving creates
 * nothing.
 */
export async function createDraft(
  actorUserId: string,
  input: { type: unknown; websiteId: unknown },
  patchInput: unknown = {},
): Promise<DraftSaveResult> {
  const { type, websiteId } = parseOrThrow(createDraftSchema, input);
  const patch = parseOrThrow(draftPatchSchema, patchInput ?? {}, "Check the experiment setup.");

  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) throw notFound("That project does not exist.");
  if (!can(access.role, "experiment.edit")) throw forbidden();

  const { variants, ...rest } = patch;

  const result = await db.$transaction(async (tx) => {
    const experiment = await draftRepo.createDraftExperiment(
      {
        websiteId: access.website.id,
        type,
        status: "DRAFT",
        name: "",
        controlWeight: 50,
        trafficAllocation: 100,
        targetDevices: [],
        keepQueryParams: true,
        wizardStep: 1,
        createdById: actorUserId,
        ...draftFields(rest),
      },
      tx,
    );

    const mapping = await reconcileVariants(
      experiment.id,
      type,
      variants ?? [{ key: "v1", name: "Variant A", weight: 50, colorIndex: 1 }],
      tx,
    );

    await activityRepo.createActivity(
      { experimentId: experiment.id, type: "CREATED", actorId: actorUserId },
      tx,
    );

    return { experiment, mapping };
  });

  return {
    id: result.experiment.id,
    type,
    updatedAt: result.experiment.updatedAt,
    variants: variants ? result.mapping : [],
    baseline: await baselineFor(access.website.id, result.experiment.controlUrl),
  };
}

/**
 * Autosave (spec §3.6): stores whatever the wizard holds, valid or not, rejecting only shape and
 * caps. DRAFT only — once launched, the setup is fixed (D7).
 */
export async function saveDraft(
  actorUserId: string,
  experimentId: string,
  patchInput: unknown,
): Promise<DraftSaveResult> {
  const { experiment: existing } = await getExperimentAccess(
    actorUserId,
    experimentId,
    "experiment.edit",
  );
  if (existing.status !== "DRAFT") throw validationFailed(lockedMessage(existing.status));

  const patch = parseOrThrow(draftPatchSchema, patchInput ?? {}, "Check the experiment setup.");
  const { variants, ...rest } = patch;
  const now = new Date();

  const mapping = await db.$transaction(async (tx) => {
    const written = await draftRepo.updateExperimentWhere(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      { status: "DRAFT" },
      // Always written, so `updatedAt` moves with every save — launch relies on that to notice a
      // draft that changed after it was validated.
      { ...draftFields(rest), updatedAt: now },
      tx,
    );
    if (written.count === 0) {
      const status = await draftRepo.findStatus(experimentId, actorUserId, tx);
      throw status
        ? validationFailed(lockedMessage(status))
        : notFound("That experiment does not exist.");
    }
    return variants ? reconcileVariants(experimentId, existing.type, variants, tx) : [];
  });

  const controlUrl =
    rest.controlUrl !== undefined ? storedUrl(rest.controlUrl) : existing.controlUrl;
  return {
    id: experimentId,
    type: existing.type,
    updatedAt: now,
    variants: mapping,
    baseline: await baselineFor(existing.websiteId, controlUrl),
  };
}

/** The setup rules plus the conflict rule, for an experiment already loaded with access. */
async function launchIssuesFor(
  experiment: experimentRepo.ExperimentWithWebsite,
  client: DbClient = db,
): Promise<LaunchIssue[]> {
  const issues = setupIssues(toRuleExperiment(experiment), { domain: experiment.website.domain });

  if (
    experiment.controlUrl &&
    pageKey(experiment.controlUrl) &&
    !issues.some((issue) => issue.field === "controlUrl") &&
    (await findConflict(experiment, client))
  ) {
    issues.push({ step: 1, field: "controlUrl", message: CONFLICT_MESSAGE });
    issues.sort((a, b) => a.step - b.step);
  }
  return issues;
}

/** Another ACTIVE experiment on the same website claiming the same page — across both types. */
async function findConflict(
  experiment: Pick<Experiment, "id" | "websiteId" | "controlUrl" | "controlMatchType">,
  client: DbClient = db,
): Promise<Experiment | undefined> {
  if (!experiment.controlUrl) return undefined;
  const candidate = { url: withScheme(experiment.controlUrl), match: experiment.controlMatchType };
  const active = await experimentRepo.listActiveExperimentsExcluding(
    experiment.websiteId,
    experiment.id,
    client,
  );
  return active.find(
    (other) =>
      other.controlUrl !== null &&
      controlUrlsConflict(candidate, { url: other.controlUrl, match: other.controlMatchType }),
  );
}

/**
 * `validateForLaunch` (spec §3.6): every step's issues with the design's messages, plus the
 * conflict rule. Empty `issues` = ready, apart from the tracking check, which needs a fetch and
 * runs at launch. Any member may ask (the review screens are read-only for Viewers).
 */
export async function validateForLaunch(
  actorUserId: string,
  experimentId: string,
): Promise<{ issues: LaunchIssue[]; ready: boolean }> {
  const { experiment } = await getExperimentAccess(actorUserId, experimentId);
  const issues = await launchIssuesFor(experiment);
  return { issues, ready: issues.length === 0 };
}

/**
 * The wizard's tracking check over the experiment's pages (A/B: page + goal; Split: control,
 * every variant, goal). Reuses OK results from the last 24 hours unless `force`.
 * Rate-limited per user: each check is up to six outbound fetches.
 */
export async function checkTracking(
  actorUserId: string,
  experimentId: string,
  options: { force?: boolean } = {},
): Promise<TrackingSummary> {
  if (
    !rateLimit(`tracking-check:${actorUserId}`, TRACKING_RATE_LIMIT, TRACKING_RATE_WINDOW_MS)
      .allowed
  ) {
    throw rateLimited(
      "You’ve checked tracking a lot in the last minute. Wait a moment and try again.",
    );
  }
  const result = await checkExperimentTracking(actorUserId, experimentId, options);
  return summarizeChecks(result.checks);
}

const TRACKING_RATE_LIMIT = 10;
const TRACKING_RATE_WINDOW_MS = 60_000;

function trackingFailureMessage(summary: TrackingSummary): string {
  const missing = summary.checks.filter((check) => check.result === "MISSING");
  if (
    missing.length > 0 &&
    missing.length === summary.checks.filter((c) => c.result !== "OK").length
  ) {
    return `We couldn’t find the Routely snippet on ${missing
      .map((check) => shortUrl(check.url))
      .join(", ")}. Install it to launch — without it, visitors won’t be counted.`;
  }
  return "We couldn’t check your pages. Make sure each URL is public and loads in a browser, then try again.";
}

/**
 * Launch (spec §3.6): DRAFT → ACTIVE.
 *
 * 1. Steps 1–4 complete (`setupIssues`) and the page not claimed by another running experiment.
 * 2. Every page the experiment depends on has a tracking check that passed in the last 24 hours;
 *    anything missing or stale is re-checked here, in parallel (~6 s at worst). This is what lets
 *    the project dashboard launch a draft without the wizard's review step.
 * 3. In one transaction, serialised per website: re-check the conflict rule, flip the status —
 *    only if it is still the draft that was validated — and log LAUNCHED.
 *
 * A rule failure throws `LaunchBlockedError` (step issues or tracking results); anything else is
 * a fault the wizard reports as "We couldn't launch your experiment".
 */
export async function launchExperiment(
  actorUserId: string,
  experimentId: string,
): Promise<LifecycleResult> {
  const { experiment } = await getExperimentAccess(actorUserId, experimentId, "experiment.edit");
  if (experiment.status !== "DRAFT") {
    throw conflict("This experiment has already been launched.");
  }

  const issues = await launchIssuesFor(experiment);
  if (issues.length > 0) {
    throw new LaunchBlockedError(
      `Fix ${issues.length} ${issues.length === 1 ? "issue" : "issues"} to launch.`,
      { issues },
    );
  }

  const tracking = summarizeChecks(
    await checkUrlsForWebsite(experiment.website, experimentTrackingUrls(experiment), {
      reuseOkWithinMs: TRACKING_CHECK_MAX_AGE_MS,
    }),
  );
  if (!tracking.allOk) {
    throw new LaunchBlockedError(trackingFailureMessage(tracking), { tracking });
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await draftRepo.lockWebsiteForLaunch(experiment.websiteId, tx);

    if (await findConflict(experiment, tx)) {
      throw new LaunchBlockedError(CONFLICT_MESSAGE, {
        issues: [{ step: 1, field: "controlUrl", message: CONFLICT_MESSAGE }],
      });
    }

    const written = await draftRepo.updateExperimentWhere(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      // Only the draft that was just validated and checked: a save in between moves `updatedAt`.
      { status: "DRAFT", updatedAt: experiment.updatedAt },
      {
        status: "ACTIVE",
        publishedAt: experiment.publishedAt ?? now,
        name: experiment.name.trim(),
        targetDevices: normalizeDevices(experiment.targetDevices),
      },
      tx,
    );

    if (written.count === 0) {
      const status = await draftRepo.findStatus(experimentId, actorUserId, tx);
      if (!status) throw notFound("That experiment does not exist.");
      throw conflict(
        status === "DRAFT"
          ? "This draft changed while it was launching. Check it and try again."
          : "This experiment has already been launched.",
      );
    }

    await activityRepo.createActivity({ experimentId, type: "LAUNCHED", actorId: actorUserId }, tx);
  });

  return { experimentId, websiteId: experiment.websiteId, status: "ACTIVE" };
}

/** Why a transition matched nothing: NOT_FOUND if the experiment vanished, else CONFLICT. */
async function transitionRefused(
  actorUserId: string,
  experimentId: string,
  message: string,
  client: DbClient,
): Promise<never> {
  const status = await draftRepo.findStatus(experimentId, actorUserId, client);
  throw status ? conflict(message) : notFound("That experiment does not exist.");
}

/**
 * Pause: ACTIVE → PAUSED. The config endpoint stops serving it (within its cache TTL, a few
 * minutes at most — spec §8 #28), ingestion rejects its events, and browsers keep their
 * assignments so returning visitors keep their arm on resume. Members who opted in are emailed;
 * the person who paused it is not.
 */
export async function pauseExperiment(
  actorUserId: string,
  experimentId: string,
): Promise<LifecycleResult> {
  const { experiment } = await getExperimentAccess(actorUserId, experimentId, "experiment.edit");

  await db.$transaction(async (tx) => {
    const written = await draftRepo.updateExperimentWhere(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      { status: "ACTIVE" },
      { status: "PAUSED", pausedAt: new Date() },
      tx,
    );
    if (written.count === 0) {
      await transitionRefused(
        actorUserId,
        experimentId,
        "Only a running experiment can be paused.",
        tx,
      );
    }
    await activityRepo.createActivity({ experimentId, type: "PAUSED", actorId: actorUserId }, tx);
  });

  notify(
    "EXPERIMENT_PAUSED",
    experiment.website.workspaceId,
    {
      experimentId,
      experimentName: experiment.name || "Untitled experiment",
      projectName: experiment.website.name,
      actorName: await draftRepo.findUserName(actorUserId),
    },
    { excludeUserId: actorUserId },
  );

  return { experimentId, websiteId: experiment.websiteId, status: "PAUSED" };
}

/**
 * Resume: PAUSED → ACTIVE with the same assignments. Re-runs the conflict rule — another
 * experiment may have been launched on the page meanwhile — but not the tracking check.
 */
export async function resumeExperiment(
  actorUserId: string,
  experimentId: string,
): Promise<LifecycleResult> {
  const { experiment } = await getExperimentAccess(actorUserId, experimentId, "experiment.edit");

  await db.$transaction(async (tx) => {
    await draftRepo.lockWebsiteForLaunch(experiment.websiteId, tx);

    if (await findConflict(experiment, tx)) {
      throw new LaunchBlockedError(CONFLICT_MESSAGE, {
        issues: [{ step: 1, field: "controlUrl", message: CONFLICT_MESSAGE }],
      });
    }

    const written = await draftRepo.updateExperimentWhere(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      { status: "PAUSED" },
      { status: "ACTIVE" },
      tx,
    );
    if (written.count === 0) {
      await transitionRefused(
        actorUserId,
        experimentId,
        "Only a paused experiment can be resumed.",
        tx,
      );
    }
    await activityRepo.createActivity({ experimentId, type: "RESUMED", actorId: actorUserId }, tx);
  });

  return { experimentId, websiteId: experiment.websiteId, status: "ACTIVE" };
}

/** End (D5): ACTIVE or PAUSED → COMPLETED, terminal. Results stay; nothing more is collected. */
export async function endExperiment(
  actorUserId: string,
  experimentId: string,
): Promise<LifecycleResult> {
  const { experiment } = await getExperimentAccess(actorUserId, experimentId, "experiment.edit");

  await db.$transaction(async (tx) => {
    const written = await draftRepo.updateExperimentWhere(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      { status: ["ACTIVE", "PAUSED"] },
      { status: "COMPLETED", endedAt: new Date() },
      tx,
    );
    if (written.count === 0) {
      await transitionRefused(
        actorUserId,
        experimentId,
        "Only a running or paused experiment can be ended.",
        tx,
      );
    }
    await activityRepo.createActivity({ experimentId, type: "ENDED", actorId: actorUserId }, tx);
  });

  return { experimentId, websiteId: experiment.websiteId, status: "COMPLETED" };
}

export interface ChooseWinnerResult extends LifecycleResult {
  /** The chosen version's name. */
  winner: string;
  basis: "RECOMMENDED" | "MANUAL";
}

/**
 * "Choose winner": records the version the team keeps. On a running or paused experiment it also
 * ends it (ACTIVE/PAUSED → COMPLETED, an ENDED activity) in the same transaction; on a completed one
 * it records — or changes — the choice. Logs WINNER_CHOSEN either way.
 *
 * Whether the choice was Routely's recommendation is decided **here**, from the counts read inside
 * the transaction after the status change — never taken from the caller — so a manual pick can't be
 * stored as a statistically backed one. Results are frozen once COMPLETED (ingestion accepts only
 * ACTIVE), so the basis stays true. Routely does not then serve the winner; the customer updates
 * their site, which the results page spells out.
 */
export async function chooseWinner(
  actorUserId: string,
  experimentId: string,
  input: unknown,
): Promise<ChooseWinnerResult> {
  const { arm } = parseOrThrow(chooseWinnerSchema, input);
  const { experiment } = await getExperimentAccess(actorUserId, experimentId, "experiment.edit");
  if (experiment.status === "DRAFT") {
    throw validationFailed("Launch the experiment before choosing a winner.");
  }
  const variantId = arm === "control" ? null : arm;
  const variantIndex =
    variantId === null ? -1 : experiment.variants.findIndex((v) => v.id === variantId);
  if (variantId !== null && variantIndex < 0) {
    throw validationFailed("That version isn’t part of this experiment.");
  }
  const ending = experiment.status !== "COMPLETED";
  const now = new Date();
  const names = [
    "Control",
    ...experiment.variants.map((v, i) => v.name.trim() || `Variant ${String.fromCharCode(65 + i)}`),
  ];

  const basis = await db.$transaction(async (tx) => {
    if (ending) {
      const ended = await draftRepo.updateExperimentWhere(
        experimentId,
        actorUserId,
        EDIT_ROLES,
        { status: ["ACTIVE", "PAUSED"] },
        { status: "COMPLETED", endedAt: now },
        tx,
      );
      if (ended.count === 0) {
        await transitionRefused(
          actorUserId,
          experimentId,
          "Only a running or paused experiment can be ended.",
          tx,
        );
      }
      await activityRepo.createActivity({ experimentId, type: "ENDED", actorId: actorUserId }, tx);
    }

    const [assigned, converted] = await Promise.all([
      assignmentRepo.countAssignmentsByVariant(experimentId, undefined, tx),
      conversionRepo.countConversionsByVariant(experimentId, undefined, tx),
    ]);
    const keys = [null, ...experiment.variants.map((v) => v.id)];
    const analysis = analyzeResults(
      keys.map((key, i) => ({
        name: names[i]!,
        visitors: assigned.get(key) ?? 0,
        conversions: converted.get(key) ?? 0,
      })),
    );
    const chosen: "RECOMMENDED" | "MANUAL" =
      winnerBasis(analysis, variantIndex + 1) === "recommended" ? "RECOMMENDED" : "MANUAL";

    const written = await draftRepo.updateExperimentWhere(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      { status: "COMPLETED" },
      {
        winnerChosenAt: now,
        winnerVariantId: variantId,
        winnerBasis: chosen,
        winnerChosenById: actorUserId,
      },
      tx,
    );
    if (written.count === 0) {
      await transitionRefused(actorUserId, experimentId, "That experiment has changed.", tx);
    }
    await activityRepo.createActivity(
      {
        experimentId,
        type: "WINNER_CHOSEN",
        actorId: actorUserId,
        meta: { variantId, name: names[variantIndex + 1]!, basis: chosen },
      },
      tx,
    );
    return chosen;
  });

  return {
    experimentId,
    websiteId: experiment.websiteId,
    status: "COMPLETED",
    winner: names[variantIndex + 1]!,
    basis,
  };
}

/**
 * Editing a paused experiment (D7): its name and the share of visitors included, nothing else —
 * any other field is refused by the schema. Logs EDITED with what changed.
 */
export async function updatePausedExperiment(
  actorUserId: string,
  experimentId: string,
  input: unknown,
): Promise<{ experimentId: string; websiteId: string; name: string; trafficAllocation: number }> {
  // The headline is the first problem: "only the name and traffic…" for a locked field, the
  // range message for a bad percentage.
  const headline =
    pausedEditSchema.safeParse(input ?? {}).error?.issues[0]?.message ?? PAUSED_EDIT_LOCKED_MESSAGE;
  const changes: PausedEdit = parseOrThrow(pausedEditSchema, input ?? {}, headline);
  const { experiment } = await getExperimentAccess(actorUserId, experimentId, "experiment.edit");

  if (experiment.status !== "PAUSED") {
    throw validationFailed(
      experiment.status === "DRAFT"
        ? "This experiment is still a draft. Change it in the setup wizard."
        : "Pause the experiment to change its name or traffic.",
    );
  }

  const diff: Record<string, { from: string | number; to: string | number }> = {};
  if (changes.name !== undefined && changes.name !== experiment.name) {
    diff["name"] = { from: experiment.name, to: changes.name };
  }
  if (
    changes.trafficAllocation !== undefined &&
    changes.trafficAllocation !== experiment.trafficAllocation
  ) {
    diff["trafficAllocation"] = {
      from: experiment.trafficAllocation,
      to: changes.trafficAllocation,
    };
  }

  const result = {
    experimentId,
    websiteId: experiment.websiteId,
    name: changes.name ?? experiment.name,
    trafficAllocation: changes.trafficAllocation ?? experiment.trafficAllocation,
  };
  const fields = Object.keys(diff);
  if (fields.length === 0) return result;

  await db.$transaction(async (tx) => {
    const written = await draftRepo.updateExperimentWhere(
      experimentId,
      actorUserId,
      EDIT_ROLES,
      { status: "PAUSED" },
      { name: result.name, trafficAllocation: result.trafficAllocation },
      tx,
    );
    if (written.count === 0) {
      await transitionRefused(
        actorUserId,
        experimentId,
        "Pause the experiment to change its name or traffic.",
        tx,
      );
    }
    await activityRepo.createActivity(
      { experimentId, type: "EDITED", actorId: actorUserId, meta: { fields, changes: diff } },
      tx,
    );
  });

  return result;
}
