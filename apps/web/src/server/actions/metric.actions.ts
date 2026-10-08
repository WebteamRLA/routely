"use server";

import { revalidatePath } from "next/cache";

import { routes } from "@/lib/routes";
import type { MetricRow } from "@/lib/view-models";
import { type ActionResult, runResult } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import * as metricService from "@/server/services/metric.service";

/** Server Actions for project metrics (the `Metric` table). */

function revalidateProject(projectId: string): void {
  revalidatePath(routes.project(projectId).dashboard, "layout");
}

/**
 * `kind`: "event" (custom event, needs `key`) or "page" (page visit, needs `url` on one of the
 * project's domains). Field errors: `name`, `key`, `url`.
 */
export async function createMetricAction(input: {
  projectId: string;
  name: string;
  kind: "event" | "page";
  key?: string;
  url?: string;
  matchType?: "exact" | "starts";
}): Promise<ActionResult<MetricRow>> {
  const user = await requireUser();
  const result = await runResult(
    () => metricService.createMetric(user.id, input),
    `Metric “${input.name?.trim()}” created`,
  );
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

/** Refuses the system metric and a metric that is the primary goal of a live experiment. */
export async function deleteMetricAction(input: {
  projectId: string;
  metricId: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await metricService.deleteMetric(user.id, input);
    return null;
  }, "Metric deleted");
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

/**
 * GTM "send test event": the page polls this (every ~2 s) after the customer fires a real event
 * and treats a `lastReceivedAt` newer than when it started waiting as success. Not simulated.
 */
export async function getMetricLastReceivedAction(input: {
  projectId: string;
  metricId: string;
}): Promise<ActionResult<{ lastReceivedAt: string | null; count24h: number }>> {
  const user = await requireUser();
  return runResult(() =>
    metricService.getMetricLastReceived(user.id, input.projectId, input.metricId),
  );
}
