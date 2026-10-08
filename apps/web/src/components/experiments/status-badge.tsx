import { cn } from "@/lib/utils";

type Status = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";

/**
 * The design's status pill: a glyph and a label on a tinted surface, so a status is never
 * carried by colour alone. Running pulses.
 *
 * ARCHIVED is the app's "ended" state and takes the design's "Completed" treatment.
 */
const PRESENTATION: Record<
  Status,
  { label: string; glyph: string; className: string; glyphClass: string }
> = {
  ACTIVE: {
    label: "Running",
    glyph: "●",
    className: "border-success-border bg-success-bg text-success-strong",
    glyphClass: "text-success",
  },
  PAUSED: {
    label: "Paused",
    glyph: "‖",
    className: "border-warning-border bg-warning-bg text-warning-text",
    glyphClass: "text-warning",
  },
  DRAFT: {
    label: "Draft",
    glyph: "○",
    className: "border-input bg-card text-ink-2",
    glyphClass: "text-arm-control",
  },
  ARCHIVED: {
    label: "Archived",
    glyph: "■",
    className: "border-[#DDE1E8] bg-[#F1F3F6] text-[#2E3A52]",
    glyphClass: "text-arm-control",
  },
};

export function ExperimentStatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const { label, glyph, className: tone, glyphClass } = PRESENTATION[status];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm border px-2 text-xs font-bold whitespace-nowrap",
        tone,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "text-[9px] leading-none",
          glyphClass,
          status === "ACTIVE" && "size-[7px] animate-rl-pulse rounded-full bg-success text-[0px]",
        )}
      >
        {glyph}
      </span>
      {label}
    </span>
  );
}
