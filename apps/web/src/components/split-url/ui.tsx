import type { ReactNode } from "react";

import { AlertCircleIcon, Svg, WarningIcon, type IconProps } from "@/components/rt/icons";
import { focusRing } from "@/components/rt/styles";
import { cn } from "@/lib/utils";

/**
 * Class strings for this screen's controls. The kit's `btn.primary` carries a drop shadow this
 * screen's reference does not, so the buttons are spelled out here.
 */
const base = `inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-[13px] no-underline disabled:cursor-default disabled:opacity-45 ${focusRing}`;

export const cls = {
  primary: `${base} h-9 border-0 bg-[#0070C9] px-4 font-semibold text-white hover:enabled:brightness-[.8]`,
  secondary: `${base} h-9 border border-[#E5E7EB] bg-white px-3.5 font-medium text-[#374151] hover:enabled:bg-[#F9FAFB] [a&]:hover:bg-[#F9FAFB]`,
  /** Accent text action ("Edit", "Add variant"). */
  link: `${base} border-0 bg-transparent font-semibold text-[#0060AD] hover:enabled:text-[#111827]`,
  /** Grey text action ("I’ll set this up later"). */
  quiet: `${base} border-0 bg-transparent font-medium hover:enabled:text-[#111827]`,
  /** 32px transparent icon button with the inset hover. */
  ghost: `inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[#4B5563] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] disabled:cursor-default disabled:opacity-45 ${focusRing}`,
  /** Grows to 44px on phones (`.rt-btn44`). */
  tall: "max-[641px]:h-11",
  input:
    "h-10 w-full min-w-0 rounded-[8px] border border-[#E5E7EB] bg-white px-3 font-[inherit] text-[14px] text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] aria-[invalid=true]:border-[#DC2626] aria-[invalid=true]:focus:border-[#DC2626] aria-[invalid=true]:focus:shadow-[0_0_0_3px_rgba(220,38,38,.12)]",
  /** Card option (radio/checkbox tile) with the accent-line hover border. */
  option: "cursor-pointer rounded-[12px] border-[1.5px] border-solid hover:!border-[#B3DBFF]",
  eyebrow: "m-0 text-[11px] leading-4 font-semibold tracking-[0.04em] text-[#6B7280] uppercase",
  sectionTitle: "m-0 text-[14px] leading-5 font-semibold text-[#111827]",
};

/** Red "!" line under a field. */
export function FieldError({
  children,
  alert = false,
  className,
}: {
  children: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  return (
    <p
      role={alert ? "alert" : undefined}
      className={cn(
        "m-0 flex items-start gap-1.5 text-[13px] leading-[18px] text-[#B91C1C]",
        className,
      )}
    >
      <AlertCircleIcon size={14} className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

/** Amber warning line under a field. */
export function FieldWarning({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "m-0 flex items-start gap-1.5 text-[13px] leading-[18px] text-[#92400E]",
        className,
      )}
    >
      <WarningIcon size={14} className="mt-0.5 flex-none" />
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

/** Grey 24px chip ("Default", "Baseline"). */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-[6px] bg-[#F3F4F6] px-2 text-[12px] font-semibold text-[#4B5563]">
      {children}
    </span>
  );
}

// --- Icons only this screen draws, with the design's exact paths ------------------------------

export const ExternalIcon = (p: IconProps) => (
  <Svg size={16} strokeWidth={1.8} {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const CodeIcon = (p: IconProps) => (
  <Svg size={18} strokeWidth={1.8} {...p}>
    <path d="m8 8-4 4 4 4" />
    <path d="m16 8 4 4-4 4" />
  </Svg>
);
export const RefreshIcon = (p: IconProps) => (
  <Svg size={15} {...p}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
    <path d="M20 3.5v5h-5" />
  </Svg>
);
export const BarsIcon = (p: IconProps) => (
  <Svg size={15} {...p}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </Svg>
);
export const RocketIcon = (p: IconProps) => (
  <Svg size={16} strokeWidth={1.8} {...p}>
    <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z" />
    <path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0" />
    <path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5" />
  </Svg>
);
/** The goal-type tile's "page visit" glyph. */
export const VisitIcon = (p: IconProps) => (
  <Svg size={18} strokeWidth={1.8} {...p}>
    <path d="M3 12a9 9 0 1 0 9-9" />
    <path d="M3 4v5h5" />
    <path d="M12 8v4l3 2" />
  </Svg>
);
export const DesktopIcon = (p: IconProps) => (
  <Svg size={22} strokeWidth={1.6} {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8" />
    <path d="M12 16v4" />
  </Svg>
);
export const MobileIcon = (p: IconProps) => (
  <Svg size={22} strokeWidth={1.6} {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M11 18h2" />
  </Svg>
);
export const TabletIcon = (p: IconProps) => (
  <Svg size={22} strokeWidth={1.6} {...p}>
    <rect x="4.5" y="2.5" width="15" height="19" rx="2" />
    <path d="M11 18h2" />
  </Svg>
);
export const TrendUpIcon = (p: IconProps) => (
  <Svg size={18} {...p}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg size={18} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const ChartIcon = (p: IconProps) => (
  <Svg size={20} strokeWidth={1.8} {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-4 3 3 5-6" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg size={16} strokeWidth={1.8} {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg size={16} strokeWidth={1.8} {...p}>
    <path d="M7 5v14l11-7z" />
  </Svg>
);
/** Short "!" without a circle, for the tracking row's missing state. */
export const BangIcon = (p: IconProps) => (
  <Svg size={13} strokeWidth={2.6} {...p}>
    <path d="M12 7v6" />
    <path d="M12 17v.3" />
  </Svg>
);
