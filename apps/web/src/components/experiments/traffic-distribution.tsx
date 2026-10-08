"use client";

import { useRef, useState } from "react";

import { armBg } from "@/components/experiments/arm-colors";
import { Input } from "@/components/ui/input";
import { applyShare, roundToTotal } from "@/lib/traffic";
import { cn } from "@/lib/utils";

/**
 * How traffic is divided between control, each variant, and the visitors left out entirely.
 *
 * Every number here is a percentage of **total site traffic**, so the bar always adds to 100 —
 * which is what makes the whole thing legible at a glance. That display model is composed from
 * two independently-stored facts, deliberately kept apart:
 *
 *  - `trafficAllocation` — what share is entered into the experiment at all. Excluded is its
 *    complement: `100 - trafficAllocation`.
 *  - the per-arm weights — how the entered share is divided. Stored as *relative* numbers, so
 *    they carry no second copy of the allocation and cannot drift from it.
 *
 * Because the weights are relative, the absolute percentages typed here can be stored verbatim
 * as weights: `40 / 40` with 20 excluded normalises to the same 50/50 of included traffic that
 * `50 / 50` would. The round trip is exact and needs no scaling step.
 */

export interface DistributionArm {
  /** `null` for control; a variant's id (or list index, for unsaved rows) otherwise. */
  key: string | null;
  label: string;
  /** Short badge text — "C", "V1", "V2"… */
  short: string;
  /** Percentage of total site traffic. */
  percent: number;
}

/** Fixed per position so an arm keeps its colour as others are added or removed. */
const armColor = armBg;

const EXCLUDED_COLOR = "bg-divider text-ink-3!";

export function TrafficDistribution({
  arms,
  excluded,
  onChange,
  disabled = false,
}: {
  arms: DistributionArm[];
  /** Percentage of total site traffic not entered into the experiment. */
  excluded: number;
  /** Receives whole-number percentages of total traffic that always sum to 100. */
  onChange: (next: { arms: DistributionArm[]; excluded: number }) => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [showExact, setShowExact] = useState(true);

  /** Every segment of the bar, in order, with excluded always last. */
  const segments = [
    ...arms.map((arm, index) => ({ ...arm, color: armColor(index) })),
    {
      key: "__excluded__",
      label: "Excluded",
      short: "×",
      percent: excluded,
      color: EXCLUDED_COLOR,
    },
  ];

  function emit(percents: number[]) {
    const normalised = roundToTotal(percents, 100);
    onChange({
      arms: arms.map((arm, index) => ({ ...arm, percent: normalised[index]! })),
      excluded: normalised[arms.length]!,
    });
  }

  /** Drag a boundary: only the two segments it sits between move, so their combined share —
   * and therefore every other segment — is untouched. */
  function handleDrag(boundary: number, clientX: number) {
    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return;

    const percents = segments.map((segment) => segment.percent);
    const cursor = ((clientX - rect.left) / rect.width) * 100;

    const before = percents.slice(0, boundary).reduce((sum, value) => sum + value, 0);
    const pairTotal = percents[boundary]! + percents[boundary + 1]!;

    const left = Math.round(Math.min(Math.max(cursor - before, 0), pairTotal));
    percents[boundary] = left;
    percents[boundary + 1] = pairTotal - left;

    emit(percents);
  }

  function startDrag(boundary: number) {
    if (disabled) return;

    const move = (event: PointerEvent) => handleDrag(boundary, event.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  /**
   * Typing an exact value keeps that value exactly, and takes the difference out of the
   * excluded slot before any other arm — see `applyShare`.
   *
   * This used to rescale every other segment proportionally, which quietly rewrote the boxes
   * the customer had just filled in. With two arms it was invisible, because the single other
   * segment absorbs the whole remainder and the result is exact either way; from three arms
   * upward the change was smeared across the rest and earlier entries drifted. Typing
   * `25 / 25 / 20 / 30` stored `26 / 25 / 19 / 30`.
   */
  function setSegment(index: number, raw: number) {
    const percents = segments.map((segment) => segment.percent);
    // Excluded is always the last segment; it is the one with no meaning of its own, so it is
    // the right place for a change to come from.
    emit(applyShare(percents, index, raw, percents.length - 1));
  }

  function resetToEqual() {
    // "Equal" means across the arms; whatever is excluded stays excluded.
    const included = 100 - excluded;
    const share = included / arms.length;
    emit([...arms.map(() => share), excluded]);
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">
          Traffic distribution
        </h3>
        <p className="text-[13px] text-ink-3">
          {disabled
            ? "Fixed while the experiment is running."
            : "Drag the edges between colours to adjust allocation."}
        </p>
      </div>

      <div>
        <div
          ref={trackRef}
          className="relative flex h-[30px] w-full overflow-hidden rounded-[7px] select-none"
        >
          {segments.map((segment) => (
            <div
              key={segment.key}
              className={cn(
                "flex items-center justify-center overflow-hidden text-xs font-extrabold whitespace-nowrap text-white transition-[width] duration-75",
                segment.color,
              )}
              style={{ width: `${segment.percent}%` }}
              title={`${segment.label} ${segment.percent}%`}
            >
              {segment.percent >= 8 ? (
                <span className="px-1">
                  {segment.short} {segment.percent}%
                </span>
              ) : null}
            </div>
          ))}

          {/* One handle per boundary, positioned at the running total to its left. */}
          {!disabled
            ? segments.slice(0, -1).map((segment, index) => {
                const offset = segments
                  .slice(0, index + 1)
                  .reduce((sum, item) => sum + item.percent, 0);

                return (
                  <button
                    key={`handle-${segment.key}`}
                    type="button"
                    onPointerDown={() => startDrag(index)}
                    aria-label={`Adjust the split between ${segment.label} and ${segments[index + 1]!.label}`}
                    className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-col-resize outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: `${offset}%` }}
                  >
                    <span className="mx-auto block h-full w-1 rounded-full bg-white/90 shadow-sm" />
                  </button>
                );
              })
            : null}
        </div>

        <div className="mt-1.5 flex justify-between text-[11px] text-faint">
          <span>0%</span>
          <span>Total site traffic</span>
          <span>100%</span>
        </div>
      </div>

      {showExact ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((segment, index) => (
            <div
              key={`input-${segment.key}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-md text-xs font-extrabold text-white",
                  segment.color,
                )}
              >
                {segment.short}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-ink-3">{segment.label}</p>
                <p className="text-sm font-bold tabular-nums">{segment.percent}%</p>
              </div>
              <Input
                type="number"
                min={0}
                max={100}
                value={segment.percent}
                disabled={disabled}
                onChange={(event) => setSegment(index, Number(event.target.value))}
                aria-label={`${segment.label} percentage`}
                className="h-9 w-16 shrink-0 text-center"
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex justify-end gap-4 text-[13px] font-bold">
        {!disabled ? (
          <button
            type="button"
            onClick={resetToEqual}
            className="cursor-pointer text-primary underline-offset-4 outline-none hover:text-brand-hover hover:underline focus-visible:ring-3 focus-visible:ring-primary/15"
          >
            Reset to equal
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowExact((value) => !value)}
          className="cursor-pointer text-primary underline-offset-4 outline-none hover:text-brand-hover hover:underline focus-visible:ring-3 focus-visible:ring-primary/15"
        >
          {showExact ? "Hide exact values" : "Show exact values"}
        </button>
      </div>
    </div>
  );
}
