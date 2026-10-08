"use client";

import { CardTitle, Section } from "@/components/rl";
import { SplitEditor } from "@/components/experiments/split-editor";
import { pathOf } from "@/lib/domain-normalize";
import { changeCount } from "@/lib/editor";

import type { StepProps } from "./types";
import { StepHeading } from "./ui";

/**
 * Step 4 — Traffic (design L967–998).
 *
 * The prototype's "≈ N visitors / day" estimates came from a made-up 1,240 visitors/day. Routely
 * has no per-page traffic history to estimate from before an experiment runs, so the estimate is
 * omitted and the coverage card says so.
 */
export function StepTraffic({ draft, update, err }: StepProps) {
  const R = draft.type === "redirect";
  const errSum = err("traffic", "sum");
  const c = draft.coverage;
  return (
    <>
      <StepHeading title="How should traffic be split?">
        Each visitor is assigned once and keeps the same version for the length of the test.
      </StepHeading>
      <Section as="div" padded className="gap-5">
        <SplitEditor
          arms={draft.arms}
          onArms={(fn) => update((d) => ({ ...d, arms: fn(d.arms) }))}
          detailFor={(i) =>
            R
              ? pathOf(i ? draft.arms[i]!.url : draft.url) || "—"
              : i
                ? changeCount(draft.arms[i]!.changes.length)
                : "Original page"
          }
        />
        {errSum ? (
          <div role="alert" className="text-[13px] font-bold text-danger-text">
            {errSum}
          </div>
        ) : null}
        {draft.arms.length === 2 ? (
          <div className="text-[12.5px] text-ink-3">
            Moving one slider rebalances the others, so the total always stays at 100%.
          </div>
        ) : null}
      </Section>
      <Section as="div" padded className="gap-2.5">
        <div className="flex items-baseline justify-between gap-2.5">
          <CardTitle as="h3">Traffic included in experiment</CardTitle>
          <span className="font-heading text-[22px] font-semibold">{c}%</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          value={c}
          aria-label="Traffic included in experiment"
          onChange={(e) => {
            const v = Math.max(1, Math.min(100, Number(e.target.value) || 1));
            update((d) => ({ ...d, coverage: v }));
          }}
          className="w-full"
        />
        <div className="text-[13px] text-ink-3">
          {c === 100
            ? "All matching visitors enter the experiment."
            : `${c}% of matching visitors enter the experiment. The other ${100 - c}% see Control and aren’t counted.`}{" "}
          Routely has no traffic history for this page before the test runs, so visitor estimates
          aren’t shown.
        </div>
      </Section>
    </>
  );
}
