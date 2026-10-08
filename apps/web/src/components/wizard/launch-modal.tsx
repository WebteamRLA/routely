"use client";

import { ArmSwatch, CheckBox, Modal, Spinner, TrafficBar } from "@/components/rl";
import type { ExperimentDraft } from "@/lib/domain";
import type { ResolvedGoal } from "@/lib/qa";
import { targetSummary } from "@/lib/targeting";
import { cn } from "@/lib/utils";

export type LaunchState =
  | { state: "confirm" | "launching"; ok: boolean; warns: string[] }
  | { state: "done"; id: string; name: string };

/** Launch confirmation (DESIGN.md 3.6, L1961–1989) and the "Your experiment is live" view. */
export function LaunchModal({
  launch,
  draft,
  goal,
  onToggle,
  onLaunch,
  onClose,
  onView,
}: {
  launch: LaunchState | null;
  draft: ExperimentDraft;
  goal: ResolvedGoal | undefined;
  onToggle: () => void;
  onLaunch: () => void;
  onClose: () => void;
  onView: () => void;
}) {
  const open = !!launch;
  const busy = launch?.state === "launching";
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={launch?.state === "done" ? "Your experiment is live" : "Launch experiment"}
      width={560}
      padded={false}
      z={96}
      locked={busy}
    >
      {launch && launch.state !== "done" ? (
        <>
          <div className="border-b border-divider px-6 py-[22px]">
            <div className="text-xs font-extrabold tracking-[0.1em] text-coral">
              READY TO LAUNCH
            </div>
            <div className="mt-1.5 font-heading text-[21px] font-semibold break-words">
              {draft.name}
            </div>
            <div className="mt-[3px] text-[13px] text-ink-3">
              {draft.type === "redirect" ? "Split URL test" : "A/B test"} ·{" "}
              <span className="font-mono break-all">{draft.url}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3.5 px-6 py-5">
            <TrafficBar
              size="lg"
              segments={draft.arms.map((a, i) => ({ weight: Number(a.weight), position: i }))}
            />
            <div className="flex flex-wrap gap-3.5">
              {draft.arms.map((a, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[13px]">
                  <ArmSwatch position={i} size={8} />
                  <b>{a.name}</b> {a.weight}%
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
              <span className="font-bold text-ink-3">Goal</span>
              <span className="font-bold break-words">
                {goal ? `${goal.name} (${goal.key})` : "—"}
              </span>
              <span className="font-bold text-ink-3">Included</span>
              <span>{draft.coverage}% of matching visitors</span>
              <span className="font-bold text-ink-3">Targeting</span>
              <span className="leading-[1.45]">{targetSummary(draft.targeting)}</span>
            </div>
            <div className="rounded-lg bg-muted p-3 text-[13px] leading-normal text-ink-2">
              Matching visitors are split immediately. You can pause at any time; pausing shows
              everyone Control without losing data.
            </div>
            {launch.warns.length ? (
              <div className="rounded-lg border border-[#F1DDB6] bg-[#FDF3E1] p-3 text-[13px] text-[#7A4E07]">
                <div className="mb-1.5 font-extrabold">
                  Launching with {launch.warns.length} warning{launch.warns.length === 1 ? "" : "s"}
                </div>
                {launch.warns.map((t, i) => (
                  <div key={i} className="mt-1 flex gap-2 leading-[1.45]">
                    <span className="shrink-0">•</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <CheckBox checked={launch.ok} onChange={onToggle} disabled={busy}>
              I’ve previewed every version and checked the goal is tracking.
            </CheckBox>
          </div>
          <div className="flex justify-end gap-2 border-t border-divider px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-10 cursor-pointer rounded-md border border-input bg-white px-4 font-bold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onLaunch}
              aria-disabled={!launch.ok || busy}
              className={cn(
                "flex h-10 items-center gap-2 rounded-md border-0 px-[18px] font-extrabold text-white",
                launch.ok && !busy
                  ? "cursor-pointer bg-brand hover:bg-brand-hover"
                  : "cursor-not-allowed bg-[#9BB0F2]",
              )}
            >
              {busy ? <Spinner size={16} onBlue /> : null}
              {busy ? "Launching…" : "Launch experiment"}
            </button>
          </div>
        </>
      ) : null}
      {launch && launch.state === "done" ? (
        <div className="flex flex-col items-start gap-3 px-7 py-8">
          <div aria-hidden className="flex gap-1.5">
            <div className="h-[30px] w-[22px] rounded-[5px] bg-brand" />
            <div className="h-[30px] w-[22px] rounded-[5px] bg-coral" />
          </div>
          <div className="font-heading text-2xl font-semibold">Your experiment is live</div>
          <div className="leading-[1.55] text-ink-2">
            “{launch.name}” is now splitting traffic. The first results usually appear within an
            hour; we’ll show a verdict once there’s enough data.
          </div>
          <button
            type="button"
            onClick={onView}
            className="mt-1.5 h-[42px] cursor-pointer rounded-md border-0 bg-brand px-[18px] font-extrabold text-white hover:bg-brand-hover"
          >
            View experiment →
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
