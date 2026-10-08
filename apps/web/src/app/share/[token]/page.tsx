import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ResultsView } from "@/components/results/results-view";
import { timingText } from "@/components/results/timing";
import { StatusPill } from "@/components/rl";
import { TYPE_LABEL } from "@/lib/verdict";
import type { ResultsRange } from "@/lib/view-models";
import { getSharedResultsView } from "@/server/services/share-results.service";

/**
 * Public, read-only results.
 *
 * Reached by an unguessable token and nothing else — no session, and no way to navigate from
 * here to anything the viewer was not given. It shows this experiment's results in the same
 * layout as the dashboard's Results tab, without any action that changes it, and does not name
 * the account or project, list other experiments, or link into the dashboard.
 *
 * Outside the `(app)` route group on purpose, so it inherits neither the authenticated layout
 * nor the proxy's protected prefixes.
 */

/** Never indexed: a share link is private-by-obscurity, and a crawler would defeat that. */
export const metadata: Metadata = {
  title: "Experiment results",
  robots: { index: false, follow: false, nocache: true },
};

const RANGES: ResultsRange[] = ["7", "14", "30", "all"];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SharedResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const rawRange = first(sp.range) as ResultsRange | undefined;
  const range = rawRange && RANGES.includes(rawRange) ? rawRange : "all";
  const goal = first(sp.goal)?.slice(0, 100);

  const view = await getSharedResultsView(token, { range, ...(goal ? { goal } : {}) });

  // An unknown token and a revoked one are the same 404. Distinguishing them would tell a
  // stranger that a link once existed, which is not theirs to learn.
  if (!view) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-navy">
        <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6">
          <span className="flex items-center gap-2.5 text-white">
            <span aria-hidden className="flex size-[22px] overflow-hidden rounded-[6px]">
              <span className="flex-1 bg-brand" />
              <span className="flex-1 bg-coral" />
            </span>
            <span className="font-heading text-[17px] font-semibold tracking-[-0.01em]">
              Routely
            </span>
          </span>
          <span className="rounded-md border border-white/20 px-2 py-0.5 text-xs font-bold text-white/80">
            Shared results · read-only
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1320px] animate-rl-in flex-col gap-[18px] px-4 pt-7 pb-16 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={view.displayStatus} />
            <span className="rounded-md border border-input px-[7px] py-0.5 text-xs font-bold text-ink-2">
              {TYPE_LABEL[view.type]}
            </span>
            <span className="text-[12.5px] text-ink-3">{timingText(view, view.timezone)}</span>
          </div>
          <h1 className="mt-2.5 mb-1 font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em] text-pretty">
            {view.name}
          </h1>
          <p className="font-mono text-[12.5px] break-all text-ink-3">{view.url}</p>
          {view.hypothesis ? (
            <p className="mt-2 max-w-[680px] text-sm text-pretty text-ink-2 italic">
              {view.hypothesis}
            </p>
          ) : null}
        </div>

        <ResultsView
          meta={{
            status: view.status,
            type: view.type,
            winnerPosition: view.winnerPosition,
            arms: view.arms,
            coverage: view.coverage,
            threshold: view.threshold,
            goals: view.goals,
          }}
          results={view.results}
          goalPerformance={view.goalPerformance}
        />

        <p className="border-t border-border pt-5 text-[12.5px] text-ink-3">
          Shared from Routely. Whoever created this link can revoke it at any time.
        </p>
      </main>
    </div>
  );
}
