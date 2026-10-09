import { cn } from "@/lib/utils";
import { armColor } from "@/lib/domain";

export interface TrafficSegment {
  weight: number;
  /** Defaults to the arm colour for `position` (or the segment's index). */
  color?: string;
  position?: number;
  label?: string;
}

/**
 * Segmented split bar. Sizes from the design: xs 6px (list), sm 8px (review), md 10px (rail),
 * lg 12px (launch modal), xl 30px (actual results, labelled), xxl 52px (wizard, labelled).
 */
const SIZES = {
  xs: "h-1.5 gap-[2px] rounded-[3px]",
  sm: "h-2 gap-[2px] rounded",
  md: "h-2.5 gap-[2px] rounded-[5px]",
  lg: "h-3 gap-[2px] rounded-md",
  xl: "h-[30px] gap-[2px] rounded-[7px]",
  xxl: "h-[52px] gap-[3px] rounded-lg",
} as const;

export function TrafficBar({
  segments,
  size = "xs",
  className,
  faded = false,
}: {
  segments: TrafficSegment[];
  size?: keyof typeof SIZES;
  className?: string;
  /** The "planned" bar under actual results is drawn at 55% opacity. */
  faded?: boolean;
}) {
  const labelled = size === "xl" || size === "xxl";
  return (
    <div className={cn("flex overflow-hidden", SIZES[size], faded && "opacity-55", className)}>
      {segments.map((seg, i) => (
        <div
          key={i}
          className={cn(
            "flex min-w-0 items-center justify-center overflow-hidden text-white transition-[flex] duration-200",
            size === "xxl" ? "text-[13px] font-extrabold" : "text-[12px] font-extrabold",
          )}
          style={{
            flex: Math.max(seg.weight, seg.weight > 0 ? 1 : 0.0001),
            background: seg.color ?? armColor(seg.position ?? i),
          }}
        >
          {labelled && seg.label && seg.weight >= 8 ? (
            <span className="truncate px-2">{seg.label}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
