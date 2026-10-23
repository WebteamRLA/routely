import { Svg, type IconProps } from "@/components/rt/icons";

/** A page split down the middle: A/B testing on one URL. */
export const AbIcon = (p: IconProps) => (
  <Svg strokeWidth={1.8} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </Svg>
);

/** A path forking in two: Split URL testing. */
export const SplitIcon = (p: IconProps) => (
  <Svg strokeWidth={1.8} {...p}>
    <path d="M3 12h6" />
    <path d="M9 12l4-6h7" />
    <path d="M9 12l4 6h7" />
    <path d="m17 3 3 3-3 3" />
    <path d="m17 15 3 3-3 3" />
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

export const ChartIcon = (p: IconProps) => (
  <Svg size={16} strokeWidth={1.8} {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-4 3 3 5-6" />
  </Svg>
);

export const FlaskIcon = (p: IconProps) => (
  <Svg size={24} strokeWidth={1.8} {...p}>
    <path d="M9 3h6" />
    <path d="M10 3v6.2L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.2V3" />
    <path d="M7.5 15h9" />
  </Svg>
);

export const RetryIcon = (p: IconProps) => (
  <Svg size={16} {...p}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
    <path d="M20 3.5v5h-5" />
  </Svg>
);
