"use client";

import { useState } from "react";

import { PreviewModal } from "@/components/editor/preview-modal";
import type { ResultsMeta } from "@/components/results/model";
import { ResultsView } from "@/components/results/results-view";
import { UnderlineTabs } from "@/components/rl";
import type { DemoState } from "@/lib/demo-state";
import type { ExperimentDetailTab } from "@/lib/routes";
import { routes } from "@/lib/routes";
import type { ArmStat } from "@/lib/stats";
import type {
  ExperimentDetail,
  ExperimentResults,
  GoalPerformance,
  MetricRow,
} from "@/lib/view-models";

import { DeleteExperimentModal } from "../delete-experiment-modal";
import { EndExperimentModal } from "../end-experiment-modal";
import { useExperimentActions } from "../use-experiment-actions";
import { ActivityTab, type ActivityRow } from "./activity-tab";
import { DetailHeader } from "./detail-header";
import { SetupTab } from "./setup-tab";
import { ShareCard } from "./share-card";

/** Experiment detail (prototype §2.5, L1342–1579). */
export function ExperimentDetailView({
  projectId,
  projectName,
  detail,
  tab,
  timing,
  completedText,
  meta,
  results,
  goalPerformance,
  activity,
  metrics,
  endArms,
  endWinner,
  demo,
}: {
  projectId: string;
  projectName: string;
  detail: ExperimentDetail;
  tab: ExperimentDetailTab;
  timing: string;
  completedText: string;
  meta: ResultsMeta;
  results: ExperimentResults | null;
  goalPerformance: GoalPerformance[] | null;
  activity: ActivityRow[];
  /** Project metrics for live editing (Setup tab of a running/paused test), else null. */
  metrics: MetricRow[] | null;
  /** All-time stats on the primary goal, for the End modal. */
  endArms: ArmStat[];
  endWinner: number;
  demo: DemoState;
}) {
  const project = routes.project(projectId);
  const actions = useExperimentActions(projectId);
  const [preview, setPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ending, setEnding] = useState<number | null>(null);

  const draft = detail.status === "draft";
  const activeTab: ExperimentDetailTab = draft ? "setup" : tab;
  const tabHref = (key: ExperimentDetailTab) =>
    project.experiment(detail.id, key === "results" ? undefined : { tab: key });

  return (
    <div className="mx-auto flex max-w-[1320px] animate-rl-in flex-col gap-[18px]">
      <DetailHeader
        backHref={project.experiments()}
        status={detail.status}
        displayStatus={detail.displayStatus}
        type={detail.type}
        timing={timing}
        name={detail.name}
        url={detail.url}
        pending={actions.pending}
        continueHref={project.editExperiment(detail.id)}
        onPreview={() => setPreview(true)}
        onDuplicate={() => actions.duplicate(detail.id)}
        onPause={() => actions.pause(detail.id)}
        onResume={() => actions.resume(detail.id)}
        onEnd={() => setEnding(endWinner)}
        onDelete={() => setDeleting(true)}
      />

      {detail.status === "paused" ? (
        <div className="rounded-lg bg-[#FDF3E1] px-4 py-3 text-[13.5px] font-semibold text-[#7A4E07]">
          Paused. All visitors currently see Control and no new data is collected. Resume to
          continue splitting traffic with the same assignments.
        </div>
      ) : null}
      {detail.status === "completed" ? (
        <div className="rounded-lg bg-brand-tint-2 px-4 py-3 text-[13.5px] font-semibold text-[#1F3FB0]">
          Experiment ended. {completedText}
        </div>
      ) : null}

      {!draft ? (
        <div className="border-b border-border">
          <UnderlineTabs
            ariaLabel="Experiment sections"
            active={activeTab}
            className="[&_[role=tab]]:px-3.5 [&_[role=tab]]:font-extrabold"
            tabs={[
              { key: "results", label: "Results", href: tabHref("results") },
              { key: "setup", label: "Setup", href: tabHref("setup") },
              { key: "activity", label: "Activity", href: tabHref("activity") },
            ]}
          />
        </div>
      ) : null}

      {activeTab === "results" && results ? (
        <ResultsView
          meta={meta}
          results={results}
          goalPerformance={goalPerformance}
          demo={demo}
          onDeclare={(w) => setEnding(w)}
        />
      ) : null}

      {activeTab === "setup" ? (
        <SetupTab projectId={projectId} detail={detail} metrics={metrics}>
          {!draft ? (
            <ShareCard projectId={projectId} experimentId={detail.id} url={detail.share.url} />
          ) : null}
        </SetupTab>
      ) : null}

      {activeTab === "activity" ? <ActivityTab rows={activity} /> : null}

      {!draft ? (
        <PreviewModal
          open={preview}
          onClose={() => setPreview(false)}
          type={detail.type}
          url={detail.url}
          arms={detail.arms.map((a) => ({
            ...(a.variantId ? { id: a.variantId } : {}),
            name: a.name,
            url: a.url,
            weight: a.weight,
            changes: a.changes,
          }))}
          initialArm={Math.min(1, detail.arms.length - 1)}
          projectName={projectName}
          experimentId={detail.id}
        />
      ) : null}

      <DeleteExperimentModal
        open={deleting}
        name={detail.name}
        pending={actions.pending}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          if (await actions.remove(detail.id, { thenList: true })) setDeleting(false);
        }}
      />

      {detail.status === "running" || detail.status === "paused" ? (
        <EndExperimentModal
          open={ending !== null}
          onClose={() => setEnding(null)}
          projectId={projectId}
          experimentId={detail.id}
          name={detail.name}
          type={detail.type}
          arms={endArms}
          initialWinner={ending ?? -1}
        />
      ) : null}
    </div>
  );
}
