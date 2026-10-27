import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { ExperimentView } from "@/components/experiment/experiment-view";
import { LiveRefresh } from "@/components/rt/live-refresh";
import { EXPERIMENT_MODES } from "@/lib/experiment-model";
import { routes } from "@/lib/routes";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { readViewerTimeZone } from "@/server/http/viewer-time-zone";
import { getExperimentDetail } from "@/server/services/experiment-results.service";

interface Props {
  params: Promise<{ experimentId: string }>;
  searchParams: SearchParams;
}

/**
 * One read per request, shared by the metadata and the page. An experiment in a workspace the
 * viewer is not a member of is NOT_FOUND — the same as one that does not exist.
 */
const loadDetail = cache(async (experimentId: string) => {
  const { user } = await requireSession(routes.experiments.detail(experimentId));
  const timeZone = await readViewerTimeZone();
  try {
    return { timeZone, detail: await getExperimentDetail(user.id, experimentId, { timeZone }) };
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { experimentId } = await params;
  const { detail } = await loadDetail(experimentId);
  return { title: detail.kind === "results" ? detail.model.name : "Experiment" };
}

/**
 * One experiment's Results and Review tabs, with pause, resume and end. A draft has no results
 * yet, so it opens in its wizard instead (there is no separate edit route).
 *
 * `?view=` is the design's mode: results (default), review, or a dialog opened over it (pause,
 * resume, end, share) — dialogs only open for someone allowed to use them.
 */
export default async function ExperimentPage({ params, searchParams }: Props) {
  const { experimentId } = await params;
  const { detail, timeZone } = await loadDetail(experimentId);
  if (detail.kind === "draft") redirect(detail.wizardHref);

  const mode = readView((await searchParams).view, EXPERIMENT_MODES, "results");
  return (
    <>
      {/* Visitors and conversions arrive while it runs; a paused or ended one cannot change. */}
      <LiveRefresh enabled={detail.model.status === "running"} />
      <ExperimentView
        key={`${experimentId}:${mode}`}
        experimentId={detail.id}
        model={detail.model}
        mode={mode}
        canEdit={detail.canEdit}
        canShare={detail.canShare}
        shareUrl={detail.shareUrl}
        sheetUrl={detail.sheetUrl}
        timeZone={timeZone}
      />
    </>
  );
}
