import type { SVGProps } from "react";

/**
 * The dashboard chrome's icons, drawn inline from the design's own paths rather than taken from
 * lucide. Lucide has near-equivalents for most of them, but "near" shows: the design's grid,
 * layers and plug have different proportions, and next to each other in a 36px nav row the
 * mismatch reads as a different icon set. Experiments and Metrics are not in the design, so
 * theirs are drawn to the same 24-unit grid and 2px stroke so they sit in the list unnoticed.
 *
 * Each takes `stroke` from `currentColor` by default; the nav overrides it for inactive rows,
 * where the design greys the icon independently of the label.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5" />
    </Svg>
  );
}

export function IntegrationsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 2v5" />
      <path d="M15 2v5" />
      <path d="M6 7h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 17v5" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3" />
      <path d="M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg width="22" height="22" strokeWidth={1.8} {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg width="20" height="20" strokeWidth={1.8} {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

export function ChevronsUpDownIcon(props: IconProps) {
  return (
    <Svg width="16" height="16" strokeWidth={1.8} {...props}>
      <path d="m8 15 4 4 4-4" />
      <path d="m8 9 4-4 4 4" />
    </Svg>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <Svg strokeWidth={1.8} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}
