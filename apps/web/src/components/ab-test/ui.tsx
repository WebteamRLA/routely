import type { ReactNode } from "react";

import { AlertCircleIcon } from "@/components/rt/icons";
import { focusRing } from "@/components/rt/styles";
import { cn } from "@/lib/utils";

/*
 * Breakpoints are written one pixel up (`max-[641px]`) because Tailwind's `max-[N]` means
 * `width < N` while the design's media queries are `max-width: N` — inclusive.
 */

/**
 * Class strings for this screen's controls. The kit's `btn.primary` carries a drop shadow this
 * screen's reference does not, so the A/B buttons are spelled out here.
 */
const base = `inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] no-underline disabled:cursor-default disabled:opacity-45 ${focusRing}`;

export const cls = {
  primary: `${base} h-9 border-0 bg-[#0070C9] px-4 font-semibold text-white hover:enabled:brightness-[.8]`,
  secondary: `${base} h-9 border border-[#E5E7EB] bg-white px-3.5 font-medium text-[#374151] hover:enabled:bg-[#F9FAFB] [a&]:hover:bg-[#F9FAFB]`,
  danger: `${base} h-9 border-0 bg-[#B91C1C] px-4 font-medium text-white hover:enabled:brightness-[.8]`,
  /** Accent text action ("Edit", "Add variant"). */
  link: `${base} border-0 bg-transparent font-semibold text-[#0060AD] hover:enabled:text-[#111827]`,
  /** Grey text action ("I’ll set this up later"). */
  quiet: `${base} border-0 bg-transparent font-medium hover:enabled:text-[#111827]`,
  /** Transparent icon button with the inset hover. */
  ghost: `inline-flex cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 hover:enabled:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] disabled:cursor-default disabled:opacity-45 ${focusRing}`,
  /** Tinted accent button ("Edit changes"). */
  tint: `${base} h-[34px] border border-[#B3DBFF] bg-[#E6F4FF] px-3 font-semibold text-[#0060AD] hover:enabled:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]`,
  /** Grows to 44px on phones (`.rt-btn44`). */
  tall: "max-[641px]:h-11",
  input:
    "w-full rounded-lg border border-[#E5E7EB] bg-white text-[14px] text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] aria-[invalid=true]:border-[#DC2626] aria-[invalid=true]:focus:border-[#DC2626] aria-[invalid=true]:focus:shadow-[0_0_0_3px_rgba(220,38,38,.12)]",
  /** Card option (radio/checkbox tile) with the accent-line hover border. */
  option: "cursor-pointer rounded-xl border-[1.5px] hover:!border-[#B3DBFF]",
  eyebrow: "m-0 text-[11px] leading-4 font-semibold tracking-[0.04em] text-[#6B7280] uppercase",
};

/** Red "!" line under a field. */
export function FieldError({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <p
      role={alert ? "alert" : undefined}
      className="m-0 flex items-start gap-1.5 text-[13px] leading-[18px] text-[#B91C1C]"
    >
      <AlertCircleIcon size={14} className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

/** Colour square/dot before a version name. */
export function Swatch({
  color,
  size = 8,
  radius = 2,
  className,
}: {
  color: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block flex-none", className)}
      style={{ width: size, height: size, borderRadius: radius, background: color }}
    />
  );
}
