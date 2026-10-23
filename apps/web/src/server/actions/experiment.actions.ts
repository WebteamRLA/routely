"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { LaunchIssue } from "@/lib/launch-rules";
import { routes } from "@/lib/routes";
import { type FormState, runAction } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import { isAppError, toPublicError } from "@/server/errors";
import * as experimentService from "@/server/services/experiment.service";

/**
 * Server Actions for experiment management.
 *
 * As with websites, the actor comes from the session and never from the submitted form — a
 * Server Action is a public HTTP endpoint, so any id in the body is attacker-supplied. The
 * service scopes every query through the parent website's owner, so an experiment or website
 * belonging to someone else resolves to "not found".
 */

/**
 * Reads a field that may not have been submitted at all.
 *
 * A **disabled `<fieldset>` submits none of its controls**, and the edit form disables the URL
 * fields once an experiment has started — so on a running experiment `controlUrl`,
 * `conversionUrl` and every variant row are simply absent. `formData.get` returns `null` for
 * those, and passing `null` on to a partial update overwrites the stored value with nothing.
 * `undefined` is what "unchanged" looks like to `updateExperiment`, which merges the changes
 * over the stored record.
 *
 * That is why re-weighting a running experiment used to fail with "expected string, received
 * null" and "At least one variant is required", despite weights deliberately being outside the
 * URL lock.
 */
function submittedText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Reads an optional text field, treating an empty submission as absent rather than as "". */
function optionalText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Reads a field as a number for Zod to validate; NaN on a bad value surfaces as a field error
 * rather than silently falling back to a default. */
function numberField(formData: FormData, name: string): number {
  return Number(formData.get(name));
}

/**
 * Reads the variant rows: repeated `variantUrl` fields (one per row, native `FormData` support
 * for a repeated `name` — no JSON-encoding needed) paired by index with repeated `variantId`
 * and `variantWeight` fields. An empty `variantId` means a row with no stored id yet. Values
 * are left unnarrowed so Zod does the actual validation rather than this second-guessing it.
 */
function readVariants(
  formData: FormData,
): { id?: string; url: FormDataEntryValue; weight: number }[] | undefined {
  const urls = formData.getAll("variantUrl");
  // No rows at all means the fieldset holding them was disabled, not that the customer removed
  // every variant — which the schema would reject outright. See `submittedText`.
  if (urls.length === 0) return undefined;

  const ids = formData.getAll("variantId").map(String);
  const weights = formData.getAll("variantWeight");

  return urls.map((url, index) => ({
    id: ids[index] || undefined,
    url,
    weight: Number(weights[index]),
  }));
}

export async function createExperimentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const result = await runAction(() =>
    experimentService.createExperiment(user.id, {
      websiteId: formData.get("websiteId"),
      name: formData.get("name"),
      description: optionalText(formData, "description"),
      controlUrl: formData.get("controlUrl"),
      controlMatchType: formData.get("controlMatchType"),
      controlWeight: numberField(formData, "controlWeight"),
      variants: readVariants(formData),
      conversionUrl: formData.get("conversionUrl"),
      conversionMatchType: formData.get("conversionMatchType"),
      primaryMetric: formData.get("primaryMetric"),
      trafficAllocation: numberField(formData, "trafficAllocation"),
    }),
  );

  if (!result.ok) {
    return result.state;
  }

  // Outside runAction: redirect() signals by throwing, and must reach Next.js uncaught.
  revalidatePath(routes.websites.detail(result.data.websiteId));
  redirect(routes.experiments.detail(result.data.id));
}

export async function updateExperimentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const experimentId = String(formData.get("experimentId") ?? "");

  const result = await runAction(() =>
    // Only what was actually submitted: anything absent stays as stored, which is what lets a
    // running experiment be re-weighted while its URLs are locked.
    experimentService.updateExperiment(user.id, experimentId, {
      name: submittedText(formData, "name"),
      description: optionalText(formData, "description"),
      controlUrl: submittedText(formData, "controlUrl"),
      controlMatchType: submittedText(formData, "controlMatchType"),
      controlWeight: numberField(formData, "controlWeight"),
      variants: readVariants(formData),
      conversionUrl: submittedText(formData, "conversionUrl"),
      conversionMatchType: submittedText(formData, "conversionMatchType"),
      primaryMetric: submittedText(formData, "primaryMetric"),
      trafficAllocation: numberField(formData, "trafficAllocation"),
    }),
  );

  if (!result.ok) {
    return result.state;
  }

  revalidatePath(routes.experiments.detail(experimentId));
  revalidatePath(routes.websites.detail(result.data.websiteId));

  return { status: "success", message: "Experiment updated." };
}

export async function changeExperimentStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const experimentId = String(formData.get("experimentId") ?? "");

  const result = await runAction(() =>
    experimentService.changeStatus(user.id, {
      experimentId,
      status: formData.get("status"),
    }),
  );

  if (!result.ok) {
    return result.state;
  }

  revalidatePath(routes.experiments.detail(experimentId));
  revalidatePath(routes.websites.detail(result.data.websiteId));

  return { status: "success" };
}

export async function deleteExperimentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const experimentId = String(formData.get("experimentId") ?? "");
  const websiteId = String(formData.get("websiteId") ?? "");

  const result = await runAction(() => experimentService.deleteExperiment(user.id, experimentId));

  if (!result.ok) {
    return result.state;
  }

  revalidatePath(routes.websites.detail(websiteId));
  redirect(websiteId ? routes.websites.detail(websiteId) : routes.experiments.list);
}

// =============================================================================================
// The new-design wizards and lifecycle.
//
// Called directly from client components with typed arguments (not through `useActionState`),
// so each returns a plain, serialisable result instead of throwing: `{ ok: true, data }`, or
// `{ ok: false, code, message }` plus, for a refused launch or resume, the step `issues` and/or
// the `tracking` results the wizard renders where the design puts them. `code` is the AppError
// code; `INTERNAL` is the only one that means "something went wrong on our side".
//
// The actor always comes from the session. Ids in the arguments only name records; the service
// decides whether the actor may touch them (NOT_FOUND for a non-member, FORBIDDEN for a Viewer).
// =============================================================================================

export type ExperimentActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: Record<string, string[]>;
      issues?: LaunchIssue[];
      tracking?: experimentService.TrackingSummary;
    };

async function run<T>(operation: () => Promise<T>): Promise<ExperimentActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const { code, message } = toPublicError(error);
    const extra =
      error instanceof experimentService.LaunchBlockedError
        ? {
            ...(error.issues ? { issues: error.issues } : {}),
            ...(error.tracking ? { tracking: error.tracking } : {}),
          }
        : {};
    const fieldErrors = isAppError(error) ? error.fieldErrors : undefined;
    return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}), ...extra };
  }
}

/** Revalidates the screens a status change shows up on. */
function revalidateLifecycle(result: experimentService.LifecycleResult): void {
  revalidatePath(routes.experiments.list);
  revalidatePath(routes.experiments.detail(result.experimentId));
  revalidatePath(routes.projects.detail(result.websiteId));
  revalidatePath(routes.dashboard);
}

/**
 * Creates a draft in `websiteId` (an `AB_TEST` or `SPLIT_URL`). The wizards call it lazily on
 * the first edit, passing that edit as `patch` so nothing is lost between create and save.
 */
export async function createDraftAction(
  type: "AB_TEST" | "SPLIT_URL",
  websiteId: string,
  patch?: unknown,
): Promise<ExperimentActionResult<experimentService.DraftSaveResult>> {
  return run(async () => {
    const user = await requireUser();
    return experimentService.createDraft(user.id, { type, websiteId }, patch);
  });
}

/** Autosave: any subset of a draft's fields (`validation/experiment.ts` `draftPatchSchema`). */
export async function saveDraftAction(
  experimentId: string,
  patch: unknown,
): Promise<ExperimentActionResult<experimentService.DraftSaveResult>> {
  return run(async () => {
    const user = await requireUser();
    return experimentService.saveDraft(user.id, experimentId, patch);
  });
}

/** The wizard's tracking check (rate-limited). `force` re-checks pages that passed recently. */
export async function checkTrackingAction(
  experimentId: string,
  options: { force?: boolean } = {},
): Promise<ExperimentActionResult<experimentService.TrackingSummary>> {
  return run(async () => {
    const user = await requireUser();
    return experimentService.checkTracking(user.id, experimentId, {
      force: options?.force === true,
    });
  });
}

/** DRAFT → ACTIVE. Refusals carry `issues` (steps 1–4, conflict) or `tracking`. */
export async function launchExperimentAction(
  experimentId: string,
): Promise<ExperimentActionResult<experimentService.LifecycleResult>> {
  const result = await run(async () => {
    const user = await requireUser();
    return experimentService.launchExperiment(user.id, experimentId);
  });
  if (result.ok) revalidateLifecycle(result.data);
  return result;
}

/** ACTIVE → PAUSED. Emails members who opted in, never the person pausing. */
export async function pauseExperimentAction(
  experimentId: string,
): Promise<ExperimentActionResult<experimentService.LifecycleResult>> {
  const result = await run(async () => {
    const user = await requireUser();
    return experimentService.pauseExperiment(user.id, experimentId);
  });
  if (result.ok) revalidateLifecycle(result.data);
  return result;
}

/**
 * Deletes an experiment with its visitors, events and results (the rows cascade). Admins and the
 * Owner may delete any experiment; an Editor only a draft (`lib/permissions.ts`) — FORBIDDEN
 * otherwise, NOT_FOUND outside the workspace.
 */
export async function removeExperimentAction(
  experimentId: string,
): Promise<ExperimentActionResult<{ experimentId: string; websiteId: string }>> {
  const result = await run(async () => {
    const user = await requireUser();
    return experimentService.deleteExperiment(user.id, experimentId);
  });
  if (result.ok) {
    revalidatePath(routes.experiments.list);
    revalidatePath(routes.projects.detail(result.data.websiteId));
    revalidatePath(routes.dashboard);
  }
  return result;
}

/** PAUSED → ACTIVE. Refused with an `issues` entry if another test now runs on the page. */
export async function resumeExperimentAction(
  experimentId: string,
): Promise<ExperimentActionResult<experimentService.LifecycleResult>> {
  const result = await run(async () => {
    const user = await requireUser();
    return experimentService.resumeExperiment(user.id, experimentId);
  });
  if (result.ok) revalidateLifecycle(result.data);
  return result;
}

/** ACTIVE or PAUSED → COMPLETED (D5). */
export async function endExperimentAction(
  experimentId: string,
): Promise<ExperimentActionResult<experimentService.LifecycleResult>> {
  const result = await run(async () => {
    const user = await requireUser();
    return experimentService.endExperiment(user.id, experimentId);
  });
  if (result.ok) revalidateLifecycle(result.data);
  return result;
}

/** While PAUSED: the name and/or `trafficAllocation`, nothing else (D7). */
export async function updatePausedExperimentAction(
  experimentId: string,
  changes: { name?: string; trafficAllocation?: number },
): Promise<
  ExperimentActionResult<{
    experimentId: string;
    websiteId: string;
    name: string;
    trafficAllocation: number;
  }>
> {
  const result = await run(async () => {
    const user = await requireUser();
    return experimentService.updatePausedExperiment(user.id, experimentId, changes);
  });
  if (result.ok) {
    revalidatePath(routes.experiments.list);
    revalidatePath(routes.experiments.detail(experimentId));
    revalidatePath(routes.projects.detail(result.data.websiteId));
    revalidatePath(routes.dashboard);
  }
  return result;
}
