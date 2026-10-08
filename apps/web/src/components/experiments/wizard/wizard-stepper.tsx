"use client";

import { cn } from "@/lib/utils";

/**
 * The wizard's step indicator.
 *
 * From the 900px breakpoint up it is a row of bars, one per step, each labelled with its number
 * (a check once completed, "!" when it holds an error) — every step reached so far can be
 * clicked to jump back to it. Below that the row would not fit its labels, so it collapses to
 * "Step n of N · Name" and a single progress bar, which is the one piece of orientation that
 * still matters when space runs out.
 */

export interface StepperItem {
  key: string;
  label: string;
}

export function WizardStepper({
  steps,
  currentIndex,
  maxIndex,
  errorIndexes,
  onSelect,
  className,
}: {
  steps: StepperItem[];
  currentIndex: number;
  /** Furthest step reached, which is as far as the customer may jump back and forth. */
  maxIndex: number;
  /** Steps holding a field error that is currently on screen. */
  errorIndexes?: ReadonlySet<number>;
  onSelect: (key: string) => void;
  className?: string;
}) {
  const current = steps[currentIndex];
  const next = steps[currentIndex + 1];
  const percent = Math.round(((currentIndex + 1) / steps.length) * 100);

  return (
    <nav aria-label="Experiment setup" className={cn("min-w-0", className)}>
      {/* Desktop: one bar per step. */}
      <div className="hidden flex-col gap-3 pt-1 pb-0.5 nav:flex">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <span className="text-xs font-extrabold tracking-[0.08em] text-ink-3 uppercase">
              Step {currentIndex + 1} of {steps.length}
            </span>
            <span className="text-[13.5px] font-extrabold text-foreground">{current?.label}</span>
          </div>
          <span className="text-[12.5px] font-semibold text-ink-3">
            {next ? `Next: ${next.label}` : "Final step"}
          </span>
        </div>

        <ol
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((item, index) => {
            const isCurrent = index === currentIndex;
            const bad = errorIndexes?.has(index) ?? false;
            const done = index < maxIndex && !isCurrent;
            const reachable = index <= maxIndex;

            return (
              <li key={item.key} className="min-w-0">
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => onSelect(item.key)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-2 rounded-sm text-left outline-none",
                    "focus-visible:ring-3 focus-visible:ring-primary/15",
                    reachable ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-1 rounded-[2px] transition-colors duration-200",
                      bad
                        ? "bg-danger"
                        : isCurrent
                          ? "bg-primary"
                          : done
                            ? "bg-navy"
                            : "bg-[#DDE1E9]",
                    )}
                  />
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        "flex-none text-[11.5px] font-extrabold tabular-nums",
                        bad
                          ? "text-danger"
                          : isCurrent
                            ? "text-primary"
                            : done
                              ? "text-success-text"
                              : "text-faint",
                      )}
                    >
                      {bad ? "!" : done ? "✓" : String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "truncate text-[12.5px]",
                        isCurrent ? "font-extrabold text-foreground" : "font-semibold text-ink-3",
                      )}
                    >
                      {item.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Mobile: "Step n of N" and a single progress bar. */}
      <div className="rounded-lg border border-border bg-card px-3.5 py-3 nav:hidden">
        <p className="text-[13px] font-extrabold">
          Step {currentIndex + 1} of {steps.length} · {current?.label}
        </p>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-2 h-1 overflow-hidden rounded-[3px] bg-divider"
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </nav>
  );
}
