"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";
import { type FormState, runAction } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
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
