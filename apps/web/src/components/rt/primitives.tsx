import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small display pieces every screen uses: the status pill with a dot, the avatar letter tile,
 * the pulsing skeleton bar, and the tinted icon tile in empty/error states.
 */

export interface Tone {
  bg: string;
  fg: string;
  dot?: string;
}

/** Shared status tones, named after the design's colour pairs. */
export const TONES = {
  green: { bg: "#DCFCE7", fg: "#166534", dot: "#16A34A" },
  amber: { bg: "#FEF3C7", fg: "#92400E", dot: "#F59E0B" },
  gray: { bg: "#F3F4F6", fg: "#4B5563", dot: "#9CA3AF" },
  blue: { bg: "#E6F4FF", fg: "#0060AD", dot: "#0070C9" },
  red: { bg: "#FEE2E2", fg: "#B91C1C", dot: "#DC2626" },
} satisfies Record<string, Tone>;

/** 24px status pill: "● Active". */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap",
        className,
      )}
      style={{ background: tone.bg, color: tone.fg }}
    >
      {tone.dot ? (
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: tone.dot }} />
      ) : null}
      {children}
    </span>
  );
}

/** Rounded letter tile used for projects and experiments. */
export function LetterTile({
  letter,
  bg,
  fg,
  size = 34,
  radius = 8,
  fontSize = 14,
}: {
  letter: string;
  bg: string;
  fg: string;
  size?: number;
  radius?: number;
  fontSize?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center font-bold"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        color: fg,
        fontSize,
      }}
    >
      {letter}
    </span>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-[rt-pulse_1.4s_ease-in-out_infinite] rounded-md bg-[#EEF0F3] motion-reduce:animate-none",
        className,
      )}
      style={style}
    />
  );
}

/** 44px tinted tile at the top of empty, error and no-results states. */
export function IconTile({
  bg,
  fg,
  size = 44,
  radius = 12,
  children,
}: {
  bg: string;
  fg: string;
  size?: number;
  radius?: number;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center"
      style={{ width: size, height: size, borderRadius: radius, background: bg, color: fg }}
    >
      {children}
    </span>
  );
}
