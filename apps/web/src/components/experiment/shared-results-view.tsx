"use client";

import { ResultsPanel } from "@/components/experiment/results-panel";
import { useViewerTimeZone } from "@/components/experiment/use-viewer-time-zone";
import { Brand } from "@/components/layout/brand";
import type { ExperimentModel } from "@/lib/experiment-model";
import { routes } from "@/lib/routes";

/**
 * The public share page: the experiment's name, status and Results tab, read-only. No tabs, no
 * actions and no navigation into the dashboard — a link-holder sees this experiment's numbers and
 * nothing else.
 */
export function SharedResultsView({
  model: m,
  timeZone,
}: {
  model: ExperimentModel;
  timeZone: string;
}) {
  useViewerTimeZone(timeZone);
  return (
    <div className="min-h-screen bg-white text-sm leading-[1.45] text-[#111827] antialiased">
      <header className="border-b border-[#EEF0F3] bg-white">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-4 px-8 max-[641px]:px-4">
          <Brand href={routes.home} />
          <span className="inline-flex h-6 items-center rounded-md bg-[#F3F4F6] px-2 text-xs font-semibold text-[#374151]">
            Shared results
          </span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-8 pt-6 pb-10 max-[641px]:px-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-[#111827]">
              {m.name}
            </h1>
            <span
              className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs leading-[1.45] font-semibold whitespace-nowrap"
              style={{ background: m.header.badge.bg, color: m.header.badge.fg }}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: m.header.badge.dot }}
              />
              {m.header.badge.label}
            </span>
          </div>
          <p className="m-0 text-sm leading-[22px] [overflow-wrap:anywhere] text-[#4B5563]">
            {m.header.sub}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <ResultsPanel m={m} />
        </div>
        <p className="m-0 border-t border-[#EEF0F3] pt-5 text-[13px] leading-[19px] text-[#6B7280]">
          Shared from Routely. Whoever created this link can turn it off at any time.
        </p>
      </main>
    </div>
  );
}
