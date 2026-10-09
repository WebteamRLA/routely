"use client";

import { Segmented } from "@/components/rl";
import type { ExperimentStatusKey } from "@/lib/domain";
import type { Verdict, VerdictKind } from "@/lib/verdict";
import type { ResultsRange } from "@/lib/view-models";

const VT: Record<VerdictKind, [bg: string, color: string, pill: string]> = {
  win: ["#EEF8F3", "#0F7A52", "WINNER"],
  control: ["#FDF1EE", "#B4361F", "CONTROL AHEAD"],
  early: ["#FFFFFF", "#4B5568", "IN PROGRESS"],
  flat: ["#F5F6F9", "#4B5568", "INCONCLUSIVE"],
  wait: ["#FFFFFF", "#4B5568", "COLLECTING DATA"],
  draft: ["#FFFFFF", "#4B5568", "DRAFT"],
};

const RANGES: { value: ResultsRange; label: string }[] = [
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "30", label: "30d" },
  { value: "all", label: "All" },
];

/** The plain-language verdict with the goal select and range switch (prototype L1401–1418). */
export function VerdictHero({
  verdict,
  status,
  goalOptions,
  goal,
  onGoal,
  range,
  onRange,
  rangeText,
  onDeclare,
}: {
  verdict: Verdict;
  status: ExperimentStatusKey;
  goalOptions: { value: string; label: string }[];
  goal: string;
  onGoal: (goal: string) => void;
  range: ResultsRange;
  onRange: (range: ResultsRange) => void;
  rangeText: string;
  /** Present only where the viewer may end the test (not on the public share page). */
  onDeclare?: () => void;
}) {
  const [bg, color, pill] = VT[verdict.kind];
  const border =
    verdict.kind === "win" ? "#B5E2CC" : verdict.kind === "control" ? "#F3C9C0" : "#E4E7EE";
  const label = verdict.kind === "win" && status !== "completed" ? "WINNING · SIGNIFICANT" : pill;
  const leader = verdict.leader;
  const canDeclare = !!onDeclare && status === "running" && !!verdict.ready && !!leader;
  return (
    <div
      className="flex flex-wrap items-end justify-between gap-5 rounded-xl border p-[clamp(18px,2.5vw,28px)]"
      style={{ background: bg, borderColor: border }}
    >
      <div className="min-w-0 flex-[1_1_420px]">
        <div className="text-[11.5px] font-extrabold tracking-[0.1em]" style={{ color }}>
          {label}
        </div>
        <div className="mt-1.5 mb-2 font-heading text-[clamp(22px,2.6vw,30px)] font-bold tracking-[-0.02em] text-ink">
          {verdict.title}
        </div>
        <div className="max-w-[680px] text-[15px] leading-[1.55] text-pretty text-[#2E3A52]">
          {verdict.body}
        </div>
        {canDeclare && leader ? (
          <button
            type="button"
            onClick={onDeclare}
            className="mt-3.5 h-[38px] cursor-pointer rounded-md border-0 bg-navy px-4 text-[13.5px] font-extrabold text-white outline-none hover:bg-[#16244A] focus-visible:ring-3 focus-visible:ring-primary/30"
          >
            {leader.i ? `Declare ${leader.name} the winner` : "End test and keep Control"} →
          </button>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-2">
        <label className="flex flex-wrap items-center justify-end gap-1.5">
          <span className="text-[12.5px] font-bold text-ink-3">Goal</span>
          <select
            value={goal}
            onChange={(e) => onGoal(e.target.value)}
            className="h-[34px] max-w-[260px] cursor-pointer rounded-md border border-input bg-card px-2 text-[13px] font-bold outline-none focus:border-brand focus:ring-3 focus:ring-primary/15"
          >
            {goalOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          variant="joined"
          ariaLabel="Date range"
          options={RANGES}
          value={range}
          onChange={onRange}
        />
        <div className="text-[12px] text-ink-3">{rangeText}</div>
      </div>
    </div>
  );
}
