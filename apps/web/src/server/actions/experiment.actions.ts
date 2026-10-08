"use server";

import { revalidatePath } from "next/cache";

import type { CountingKey, ExperimentDraft } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { ExperimentResults, GoalPerformance, ResultsRange } from "@/lib/view-models";
import { type ActionResult, runResult } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import * as analyticsService from "@/server/services/analytics.service";
import * as experimentService from "@/server/services/experiment.service";

/**
 * Server Actions for experiment management.
 *
 * As with websites, the actor comes from the session and never from the submitted form — a
 * Server Action is a public HTTP endpoint, so any id in the body is attacker-supplied. The
 * service scopes every query through the parent website's owner, so an experiment or website
 * belonging to someone else resolves to "not found".
 */

// ===========================================================================================
// Project-scoped actions (the new UI). RPC-style: call directly, get an `ActionResult`.
// None of them redirect — the caller navigates with the returned id.
// ===========================================================================================

function revalidateProject(projectId: string): void {
  // Layout-level: the dashboard, list, detail and wizard pages all live under /p/<id>.
  revalidatePath(routes.project(projectId).dashboard, "layout");
  revalidatePath(routes.projects);
}

/** Creates or updates a DRAFT. Lenient: an empty name is stored as "Untitled experiment". */
export async function saveDraftAction(
  draft: ExperimentDraft,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const result = await runResult(
    () => experimentService.saveDraft(user.id, draft?.projectId, draft),
    "Draft saved",
  );
  if (result.status === "success") revalidateProject(draft.projectId);
  return result;
}

/**
 * Fully validates and launches (create or update the draft, then ACTIVE). On failure,
 * `fieldErrors` keys are `step.field` (`basics.url`, `variants.v1`, `traffic.sum`,
 * `targeting.pattern`, `goal.conv`, `goal.goal`, `goal.secondary`, `variants.arms`, …).
 */
export async function launchExperimentAction(
  draft: ExperimentDraft,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const result = await runResult(
    () => experimentService.launch(user.id, draft?.projectId, draft),
    "Experiment launched",
  );
  if (result.status === "success") revalidateProject(draft.projectId);
  return result;
}

type Target = { projectId: string; experimentId: string };

async function lifecycle(
  input: Target,
  operation: (userId: string, projectId: string, experimentId: string) => Promise<unknown>,
  message: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await operation(user.id, input.projectId, input.experimentId);
    return null;
  }, message);
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

export async function pauseExperimentAction(input: Target): Promise<ActionResult> {
  return lifecycle(input, experimentService.pause, "Paused · visitors now see Control");
}

export async function resumeExperimentAction(input: Target): Promise<ActionResult> {
  return lifecycle(input, experimentService.resume, "Experiment resumed");
}

/** Only drafts and completed experiments can be deleted. */
export async function deleteProjectExperimentAction(input: Target): Promise<ActionResult> {
  return lifecycle(input, experimentService.remove, "Experiment deleted");
}

/**
 * Ends a running/paused experiment. `winnerPosition`: 0 = control, n = variant n, null = no
 * winner. `keepWinner` only applies to a Split URL test with a variant winner.
 */
export async function endExperimentAction(
  input: Target & { winnerPosition: number | null; keepWinner?: boolean },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await experimentService.end(user.id, input);
    return null;
  }, "Experiment ended");
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

/** Copies the setup into a new draft "Copy of …"; returns its id. */
export async function duplicateExperimentAction(
  input: Target,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const result = await runResult(
    () => experimentService.duplicate(user.id, input.projectId, input.experimentId),
    "Duplicated as a draft",
  );
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

/** Post-launch edits: name, hypothesis, weights (same arm count, sum 100), coverage,
 * secondary goals, counting. Everything else is fixed after launch. */
export async function editLiveExperimentAction(
  input: Target & {
    name?: string;
    hypothesis?: string;
    weights?: number[];
    coverage?: number;
    secondary?: string[];
    counting?: CountingKey;
  },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await experimentService.editLive(user.id, input);
    return null;
  }, "Changes saved");
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

/** Public results link: turn on (idempotent), issue a new one, or turn off. */
export async function setSharingAction(
  input: Target & { mode: "enable" | "rotate" | "disable" },
): Promise<ActionResult<{ token: string | null; url: string | null }>> {
  const user = await requireUser();
  const messages = {
    enable: "Share link created.",
    rotate: "New link created. The previous one no longer works.",
    disable: "Sharing turned off. The link no longer works.",
  } as const;
  const result = await runResult(
    () => experimentService.setSharing(user.id, input.projectId, input.experimentId, input.mode),
    messages[input.mode],
  );
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

/** Results for client-side switching of range / goal / counting without a navigation. */
export async function getExperimentResultsAction(
  input: Target & { range?: ResultsRange; goal?: string; counting?: CountingKey },
): Promise<ActionResult<ExperimentResults>> {
  const user = await requireUser();
  return runResult(() =>
    analyticsService.getExperimentResults(user.id, input.projectId, input.experimentId, {
      ...(input.range ? { range: input.range } : {}),
      ...(input.goal ? { goal: input.goal } : {}),
      ...(input.counting ? { counting: input.counting } : {}),
    }),
  );
}

export async function getGoalPerformanceAction(
  input: Target & { range?: ResultsRange },
): Promise<ActionResult<GoalPerformance[]>> {
  const user = await requireUser();
  return runResult(() =>
    analyticsService.getGoalPerformance(
      user.id,
      input.projectId,
      input.experimentId,
      input.range ?? "all",
    ),
  );
}
