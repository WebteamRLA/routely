import { cn } from "@/lib/utils";
import type { DisplayStatusKey } from "@/lib/domain";

/** The design's STATUS table: glyph + label so status never relies on colour alone. */
export const STATUS_STYLE: Record<
  DisplayStatusKey,
  { label: string; glyph: string; gc: string; bg: string; color: string; border: string }
> = {
  running: {
    label: "Running",
    glyph: "●",
    gc: "#13A06B",
    bg: "#EAF7F1",
    color: "#0B6B47",
    border: "#C3E7D6",
  },
  paused: {
    label: "Paused",
    glyph: "‖",
    gc: "#B7790B",
    bg: "#FDF5E6",
    color: "#8A5A06",
    border: "#F1DDB6",
  },
  draft: {
    label: "Draft",
    glyph: "○",
    gc: "#7C879C",
    bg: "#FFFFFF",
    color: "#4B5568",
    border: "#D5DAE4",
  },
  completed: {
    label: "Completed",
    glyph: "■",
    gc: "#7C879C",
    bg: "#F1F3F6",
    color: "#2E3A52",
    border: "#DDE1E8",
  },
  winner: {
    label: "Winner",
    glyph: "★",
    gc: "#F0603F",
    bg: "#0A1633",
    color: "#FFFFFF",
    border: "#0A1633",
  },
};

export function StatusPill({
  status,
  className,
}: {
  status: DisplayStatusKey;
  className?: string;
}) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm border px-2 text-xs font-bold whitespace-nowrap",
        className,
      )}
      style={{ background: s.bg, color: s.color, borderColor: s.border }}
    >
      <span
        aria-hidden
        className={cn(
          "text-[9px] leading-none",
          status === "running" && "animate-rl-pulse rounded-full",
        )}
        style={{ color: s.gc }}
      >
        {s.glyph}
      </span>
      {s.label}
    </span>
  );
}
