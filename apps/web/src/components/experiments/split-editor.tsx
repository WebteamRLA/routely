"use client";

import { ArmSwatch, ResultPill, TrafficBar } from "@/components/rl";
import { evenSplit, setWeight, totalWeight } from "@/lib/traffic";
import { cn } from "@/lib/utils";

/** "Total 100%" / "Total 90% · 10% unallocated" / "Total 110% · 10% over". */
function sumText(sum: number): string {
  if (sum === 100) return "Total 100%";
  return sum < 100
    ? `Total ${sum}% · ${100 - sum}% unallocated`
    : `Total ${sum}% · ${sum - 100}% over`;
}

/**
 * The traffic-split editor shared by the wizard's Traffic step and live editing on the Setup tab:
 * labelled split bar, total pill with "Split evenly", and a slider + percent field per arm. Moving
 * one arm rebalances the others (`setWeight`). Renders a fragment, so the parent's gap applies.
 */
export function SplitEditor<T extends { name: string; weight: number }>({
  arms,
  onArms,
  detailFor,
  compact = false,
}: {
  arms: T[];
  onArms: (fn: (arms: T[]) => T[]) => void;
  /** The mono line under each arm's name (URL path, change count…). */
  detailFor: (i: number) => string;
  /** Setup tab: 30px bar, 10px swatches, tighter rows. Wizard: 52px bar, 12px swatches. */
  compact?: boolean;
}) {
  const sum = totalWeight(arms);
  return (
    <>
      <TrafficBar
        size={compact ? "xl" : "xxl"}
        segments={arms.map((a, i) => ({
          weight: Number(a.weight),
          position: i,
          label:
            Number(a.weight) >= 12
              ? `${i ? a.name.replace("Variant ", "") : "Control"} · ${a.weight}%`
              : "",
        }))}
      />
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <ResultPill ok={sum === 100}>
          {sum === 100 ? "✓ " : ""}
          {sumText(sum)}
        </ResultPill>
        <button
          type="button"
          onClick={() => onArms((a) => evenSplit(a))}
          className="h-8 cursor-pointer rounded-md border border-input bg-white px-3 text-[12.5px] font-bold hover:bg-muted"
        >
          Split evenly
        </button>
      </div>
      {arms.map((a, i) => {
        const onW = (v: string) => onArms((x) => setWeight(x, i, v));
        return (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_92px] items-center gap-x-4 gap-y-2 border-t border-divider sm:grid-cols-[minmax(140px,1fr)_minmax(140px,2fr)_92px]",
              compact ? "pt-3" : "pt-3.5",
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <ArmSwatch position={i} size={compact ? 10 : 12} />
              <div className="min-w-0">
                <div className="font-extrabold">{a.name}</div>
                <div className="truncate font-mono text-[11.5px] text-ink-3">{detailFor(i)}</div>
              </div>
            </div>
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
              <input
                type="range"
                min={0}
                max={100}
                value={a.weight}
                aria-label={`${a.name} traffic share`}
                onChange={(e) => onW(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="col-start-2 row-start-1 flex items-center gap-1 sm:col-start-auto sm:row-start-auto">
              <input
                type="number"
                min={0}
                max={100}
                value={a.weight}
                aria-label={`${a.name} percent`}
                onChange={(e) => onW(e.target.value)}
                className="h-9 w-16 rounded-md border border-input px-2 text-right text-sm font-bold outline-none focus:border-brand"
              />
              <span className="font-bold text-ink-3">%</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
