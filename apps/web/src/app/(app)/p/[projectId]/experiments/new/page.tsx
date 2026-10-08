import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadWizardContext, parseStep } from "@/components/wizard/data";
import { WizardEntry } from "@/components/wizard/wizard-entry";
import { newDraft } from "@/lib/validate-draft";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";

export const metadata: Metadata = { title: "New experiment" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Create wizard. `?type=ab|redirect` skips the Type step (the "New A/B test" / "New split URL
 * test" buttons); without it the wizard opens on Type with Split URL preselected, as "+ New
 * experiment" does in the design. `?step=` is honoured up to Setup for a fresh draft.
 */
export default async function NewExperimentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ projectId }, sp, user] = await Promise.all([params, searchParams, requireUser()]);
  const ctx = await loadWizardContext(user.id, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const typeParam = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const type = typeParam === "ab" ? "ab" : "redirect";
  const preset = typeParam === "ab" || typeParam === "redirect";
  const first = preset ? 1 : 0;
  const step = Math.min(parseStep(sp.step) ?? first, 1);

  return (
    <WizardEntry
      {...ctx}
      start={{
        mode: "new",
        draft: newDraft(projectId, type),
        step,
        maxStep: Math.max(step, first),
      }}
    />
  );
}
