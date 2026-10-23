"use server";

import { revalidatePath } from "next/cache";

import { routes } from "@/lib/routes";
import { type FormState, runAction } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import * as experimentService from "@/server/services/experiment.service";
import * as metricsService from "@/server/services/metrics.service";
import * as pixelService from "@/server/services/pixel.service";

/**
 * Server Actions for the metrics list.
 *
 * The actor comes from the session and never from the submitted form — a Server Action is a
 * public HTTP endpoint, so every id in the body is attacker-supplied. The services scope each
 * query through the owning website, so somebody else's goal resolves to "not found" rather
 * than to "forbidden".
 */

/** Saves a goal's label, URL and match type. */
export async function updateMetricAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const experimentId = String(formData.get("experimentId") ?? "");
  const name = String(formData.get("conversionName") ?? "").trim();
  const url = String(formData.get("conversionUrl") ?? "").trim();
  const matchType = String(formData.get("conversionMatchType") ?? "EXACT");

  // Routed through `updateExperiment` rather than writing the columns directly, so a goal
  // edited here passes exactly the same rules as one edited on the experiment page: the
  // same-site check, the collision checks against control and variants, and the lock that
  // freezes URLs once visitors have been bucketed.
  const result = await runAction(() =>
    experimentService.updateExperiment(user.id, experimentId, {
      conversionName: name || undefined,
      conversionUrl: url,
      conversionMatchType: matchType,
    }),
  );

  if (!result.ok) return result.state;

  revalidatePath(routes.metrics.list);
  revalidatePath(routes.experiments.detail(experimentId));

  return { status: "success", message: "Conversion goal saved." };
}

/**
 * Deletes the experiments behind the selected goals.
 *
 * One action for both the row menu and the bulk bar: a single deletion is a selection of one,
 * and giving them separate paths is how the two drift apart.
 */
export async function deleteMetricsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const experimentIds = formData.getAll("experimentId").map(String).filter(Boolean);

  if (experimentIds.length === 0) {
    return { status: "error", message: "Select at least one metric to delete." };
  }

  const result = await runAction(() => metricsService.deleteMetrics(user.id, experimentIds));
  if (!result.ok) return result.state;

  revalidatePath(routes.metrics.list);
  revalidatePath(routes.experiments.list);
  revalidatePath(routes.getStarted);

  return {
    status: "success",
    message: `Deleted ${result.data} experiment${result.data === 1 ? "" : "s"} and ${
      result.data === 1 ? "its" : "their"
    } results.`,
  };
}

/**
 * Loads the goal URL and reports whether the tracking snippet is on it.
 *
 * A goal only records anything if the page that satisfies it is tracked, so this is the same
 * check the install flow runs — reused rather than reimplemented, because two definitions of
 * "installed" is one more than the product can keep true.
 */
export async function validateGoalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");
  const url = String(formData.get("conversionUrl") ?? "").trim();

  const result = await runAction(() =>
    pixelService.verifyInstallation(user.id, { websiteId, url }),
  );

  if (!result.ok) return result.state;

  const check = result.data;

  if (!check.pageLoaded) {
    return {
      status: "error",
      message: `${check.loadError ?? "We couldn't load that page."} We need a goal page we can load to check it.`,
    };
  }

  if (check.scriptFound) {
    return { status: "success", message: "Goal page loads and the snippet is on it." };
  }

  return {
    status: "error",
    message: check.wrongSiteId
      ? "That page has a Routely snippet, but for a different website. Conversions there will not reach this experiment."
      : "That page loaded, but the Routely snippet is not on it — conversions there cannot be recorded.",
  };
}
