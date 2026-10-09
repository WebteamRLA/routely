import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { loadWizardContext, parseStep } from "@/components/wizard/data";
import { WizardEntry } from "@/components/wizard/wizard-entry";
import { WIZARD_STEPS } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { draftFromExperiment } from "@/lib/validate-draft";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as experimentService from "@/server/services/experiment.service";

export const metadata: Metadata = { title: "Edit experiment" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Edit wizard — drafts only. A launched experiment's setup is fixed, so anything else goes to
 * its detail page. Every step is reachable (the design's `editDraft`, maxStep = the last step);
 * it opens on `?step=` or Setup.
 */
export default async function EditExperimentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; experimentId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ projectId, experimentId }, sp, user] = await Promise.all([
    params,
    searchParams,
    requireUser(),
  ]);
  const [ctx, detail] = await Promise.all([
    loadWizardContext(user.id, projectId),
    experimentService.getExperimentDetail(user.id, projectId, experimentId),
  ]).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  if (detail.status !== "draft") redirect(routes.project(projectId).experiment(experimentId));

  const step = parseStep(sp.step) ?? 1;
  return (
    <WizardEntry
      {...ctx}
      start={{
        mode: "edit",
        draft: draftFromExperiment(detail.draftSource),
        step,
        maxStep: WIZARD_STEPS.length - 1,
      }}
    />
  );
}
