import { cn } from "@/lib/utils";

/** Confidence colour: green at/above the threshold, red at/below its mirror, else `neutral`. */
export function confColor(prob: number | null, threshold: number, neutral = "#8DA3EE"): string {
  if (prob == null) return neutral;
  if (prob >= threshold) return "#13A06B";
  if (prob <= 1 - threshold) return "#D13B3B";
  return neutral;
}

/**
 * "Chance to beat control" bar with the significance-threshold marker. Green at or above the
 * threshold, red at or below its mirror, soft blue in between.
 */
export function ConfidenceBar({
  prob,
  threshold,
  marker = true,
  className,
}: {
  /** 0–1, or null for control/no data. */
  prob: number | null;
  threshold: number;
  marker?: boolean;
  className?: string;
}) {
  const p = prob ?? 0;
  const color = prob == null ? "#9AA3B5" : confColor(p, threshold);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-1.5 flex-1 rounded-[3px] bg-divider">
        <div
          className="h-full rounded-[3px]"
          style={{ width: `${Math.round(p * 100)}%`, background: color }}
        />
        {marker ? (
          <div
            aria-hidden
            className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-navy"
            style={{ left: `${Math.round(threshold * 100)}%` }}
          />
        ) : null}
      </div>
      <span className="min-w-[34px] text-right text-[12.5px] font-extrabold tabular-nums">
        {prob == null ? "—" : `${Math.round(p * 100)}%`}
      </span>
    </div>
  );
}
