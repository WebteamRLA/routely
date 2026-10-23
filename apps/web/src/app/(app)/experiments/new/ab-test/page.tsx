import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AbTestView } from "@/components/ab-test/ab-test-view";
import { env } from "@/env";
import { setupIssues } from "@/lib/launch-rules";
import {
  AB_TEST_VIEWS,
  emptyForm,
  formFromDraft,
  resumeInfoFor,
  ruleExperiment,
} from "@/lib/mock/ab-test";
import { can } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import { buildInstallSnippet } from "@/lib/snippet";
import { readView, type SearchParams } from "@/lib/view-param";
import { type WizardCtx, resumeStep, savedLabelFor } from "@/lib/wizard-draft";
import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as experimentService from "@/server/services/experiment.service";
import { readStoredChanges } from "@/validation/visual-change";

export const metadata: Metadata = { title: "New A/B test" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * New A/B test — the setup wizard, visual editor, tracking check and launch flow.
 *
 * Inside the dashboard shell, as in the design: the wizard keeps the sidebar, and only the visual
 * editor goes full-screen, as an overlay.
 *
 * - No query: a new test in the workspace's newest project (`?project=<id>` picks one). Nothing is
 *   stored until the first edit, which creates the draft and swaps `?id=` into the URL.
 * - `?id=<draftId>`: reopens that draft at the step it was left on, with the design's "Welcome
 *   back" banner. Past DRAFT it redirects to `/experiments/[id]`; a Split URL draft goes to its own
 *   wizard. A Viewer sees the draft without being able to change it.
 * - `?view=<state>`: the design's named states with seeded data and simulated actions, for
 *   comparing against the prototype. Nothing is read or written.
 */
export default async function NewAbTestPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const id = first(params["id"]);
  const view = first(params["view"]);

  if (view && !id) {
    const initial = readView(view, AB_TEST_VIEWS, "new");
    // Keyed so switching `?view=` on the client re-initialises the screen instead of keeping state.
    return <AbTestView key={initial} view={initial} />;
  }

  const user = await requireUser();
  const now = new Date();

  if (id) {
    let draft: Awaited<ReturnType<typeof experimentService.getWizardDraft>>;
    try {
      draft = await experimentService.getWizardDraft(user.id, id);
    } catch (error) {
      if (isAppError(error) && error.code === "NOT_FOUND") notFound();
      throw error;
    }
    const { experiment, role, baseline } = draft;
    if (experiment.type !== "AB_TEST") redirect(routes.experiments.wizard(experiment.type, id));
    if (experiment.status !== "DRAFT") redirect(routes.experiments.detail(id));

    const form = formFromDraft({
      ...experiment,
      variants: experiment.variants.map((variant) => ({
        ...variant,
        changes: readStoredChanges(variant.changes),
      })),
    });
    const ctx: WizardCtx = {
      live: true,
      draftId: experiment.id,
      projectId: experiment.website.id,
      domain: experiment.website.domain,
      pixelKey: experiment.website.publicSiteId,
      snippet: buildInstallSnippet({
        sdkUrl: env.SDK_URL,
        publicSiteId: experiment.website.publicSiteId,
      }),
      baseline,
      readOnly: !can(role, "experiment.edit"),
    };
    const step = resumeStep(
      experiment.wizardStep,
      setupIssues(ruleExperiment(form), { domain: ctx.domain }),
    );

    return (
      <AbTestView
        key={experiment.id}
        view="new"
        live={{
          ctx,
          form,
          step,
          savedLabel: savedLabelFor(experiment.updatedAt, now),
          resumeInfo: resumeInfoFor(form, step, experiment.updatedAt, now, ctx.domain),
        }}
      />
    );
  }

  const access = await experimentService.resolveWizardWebsite(
    user.id,
    user.workspaceId,
    first(params["project"]),
  );
  // An experiment belongs to a project; with none yet, creating one comes first.
  if (!access) redirect(routes.projects.list);
  if (!can(access.role, "experiment.edit")) redirect(routes.experiments.list);

  const { website } = access;
  const ctx: WizardCtx = {
    live: true,
    draftId: null,
    projectId: website.id,
    domain: website.domain,
    pixelKey: website.publicSiteId,
    snippet: buildInstallSnippet({ sdkUrl: env.SDK_URL, publicSiteId: website.publicSiteId }),
    baseline: null,
    readOnly: false,
  };

  return (
    <AbTestView
      key={`new-${website.id}`}
      view="new"
      live={{ ctx, form: emptyForm(), step: 1, savedLabel: "", resumeInfo: null }}
    />
  );
}
