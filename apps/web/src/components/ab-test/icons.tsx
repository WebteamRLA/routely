import { Svg, type IconProps } from "@/components/rt/icons";

/** Icons only the A/B test screen draws, with the design's exact paths. */

export const EyeIcon = (p: IconProps) => (
  <Svg size={15} strokeWidth={1.8} {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const LockIcon = (p: IconProps) => (
  <Svg size={14} {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
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
export const RocketIcon = (p: IconProps) => (
  <Svg size={16} strokeWidth={1.8} {...p}>
    <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z" />
    <path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0" />
    <path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5" />
  </Svg>
);
export const HistoryIcon = (p: IconProps) => (
  <Svg size={20} strokeWidth={1.8} {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const BarsIcon = (p: IconProps) => (
  <Svg size={15} {...p}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
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
export const UndoIcon = (p: IconProps) => (
  <Svg size={17} strokeWidth={1.8} {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
);
export const ImageIcon = (p: IconProps) => (
  <Svg size={34} strokeWidth={1.4} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 17-5-5-9 8" />
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
/** The "!" in a circle used inline by field errors (slightly different from AlertCircleIcon). */
export const SmallAlertIcon = (p: IconProps) => (
  <Svg size={14} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16v.3" />
  </Svg>
);
