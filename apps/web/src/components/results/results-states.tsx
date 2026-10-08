"use client";

import type { ReactNode } from "react";

import { ErrorCard, Section, Shimmer, Spinner } from "@/components/rl";
import { Button } from "@/components/ui/button";

export function ResultsLoading() {
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true" aria-label="Loading results">
      <Shimmer className="h-[140px]" />
      <Shimmer className="h-[340px]" />
    </div>
  );
}

export function ResultsError({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorCard
      title="Results are temporarily unavailable"
      body="The reporting service didn’t respond. Visitor assignment and tracking are unaffected, so no data is lost."
      action={
        <Button variant="dark" size="sm" className="h-9" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}

/** No visitors yet (running) or none in the selected window. */
export function ResultsWaiting({
  live,
  action,
}: {
  /** Running: the prototype's "waiting" copy. Otherwise, nothing was recorded in the window. */
  live: boolean;
  action?: ReactNode;
}) {
  return (
    <Section as="div" className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
      {live ? <Spinner size={34} /> : null}
      <div className="font-heading text-[19px] font-semibold">
        {live ? "Waiting for the first visitors" : "No visitors in this period"}
      </div>
      <div className="max-w-[480px] leading-[1.55] text-ink-3">
        {live
          ? "The experiment is live. Results appear as soon as visitors are assigned, usually within an hour. You’ll get a plain-language verdict once there’s enough data."
          : "Nothing was recorded for this experiment in the selected range."}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </Section>
  );
}
