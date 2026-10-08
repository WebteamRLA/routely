import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Relative improvement of the variant over the control.
 *
 * Shown as a **relative** change, and labelled as such: the gap between 5% and 7% is two
 * percentage points but a 40% improvement, and the two are read very differently. Presenting
 * the larger number without saying which it is would be the misleading choice.
 *
 * `null` renders as a dash rather than 0% — "not measurable yet" and "no difference" are
 * different facts, and collapsing them would let an experiment with no data look like a tie.
 */
export function LiftBadge({
  lift,
  /** When false the value is withheld: too little data for the number to mean anything. */
  meaningful = true,
  className,
}: {
  lift: number | null;
  meaningful?: boolean;
  className?: string;
}) {
  if (lift === null || !meaningful) {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-sm text-muted-foreground", className)}
        title={
          meaningful
            ? "Not measurable yet — the control has no conversions to improve on."
            : "Too little traffic for this comparison to mean anything."
        }
      >
        <Minus className="size-3.5" aria-hidden />
        <span className="tabular-nums">—</span>
      </span>
    );
  }

  const flat = Math.abs(lift) < 0.005;
  const Icon = flat ? Minus : lift > 0 ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-extrabold tabular-nums",
        flat ? "text-ink-2" : lift > 0 ? "text-success-text" : "text-danger-text",
        className,
      )}
      title="Relative change in conversion rate versus the control. Descriptive only — not a significance test."
    >
      <Icon className="size-3.5" aria-hidden />
      {lift > 0 && !flat ? "+" : ""}
      {lift < 0 && !flat ? "−" : ""}
      {Math.abs(lift * 100).toFixed(1)}%
    </span>
  );
}
