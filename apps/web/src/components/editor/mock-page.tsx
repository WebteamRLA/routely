"use client";

import type { CSSProperties, ReactNode } from "react";

import { STRIPES } from "@/components/rl";
import type { EditorElement } from "@/lib/domain";
import type { PageVals } from "@/lib/editor";
import { cn } from "@/lib/utils";

import { resolveImageUrl } from "./preview-link";

/** The design's site brand on the mock page: the project's first word, lowercased. */
export function siteBrand(projectName: string): string {
  return (projectName.trim().split(/\s+/)[0] ?? "").toLowerCase() || "yoursite";
}

/**
 * The representative landing page the visual editor and the preview render (design L1878–1891,
 * L1940–1950). Read-only unless `interactive` is given, in which case every element is a
 * selectable target with the editor's outlines.
 */
export function MockHero({
  vals,
  pageUrl,
  layout,
  mobile = false,
  interactive,
}: {
  vals: PageVals;
  pageUrl: string;
  /** `editor`: row only on wide screens and desktop device. `preview`: wrapping columns. */
  layout: "editor" | "preview";
  mobile?: boolean;
  interactive?: {
    selected: EditorElement | null;
    changed: (el: EditorElement) => boolean;
    onSelect: (el: EditorElement) => void;
  };
}) {
  const target = (
    el: EditorElement,
    className: string,
    children: ReactNode,
    style?: CSSProperties,
  ) => {
    if (!interactive) {
      return (
        <div className={className} style={style}>
          {children}
        </div>
      );
    }
    const on = interactive.selected === el;
    const outline = on
      ? "2px solid #2B59F0"
      : interactive.changed(el)
        ? "2px dashed #F0603F"
        : "2px dashed rgba(43,89,240,0.3)";
    return (
      <button
        type="button"
        data-el={el}
        aria-pressed={on}
        onClick={() => interactive.onSelect(el)}
        className={cn("cursor-pointer border-0 bg-transparent p-0 text-left", className)}
        style={{ outline, outlineOffset: 4, borderRadius: 3, ...style }}
      >
        {children}
      </button>
    );
  };

  const img = resolveImageUrl(vals.image, pageUrl);
  const heroDir =
    layout === "preview" ? "flex-wrap" : mobile ? "flex-col" : "flex-col min-[1100px]:flex-row";

  return (
    <div
      className={cn(
        "flex gap-7 px-7",
        layout === "preview" ? "pt-9 pb-11" : "pt-9 pb-10",
        heroDir,
        "items-center",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col items-start gap-3.5",
          layout === "preview" ? "flex-[1_1_320px]" : "w-full flex-1",
        )}
      >
        {target("eyebrow", "text-xs font-extrabold tracking-[0.12em] text-brand", vals.eyebrow)}
        {target(
          "headline",
          // The line height comes after the size: tailwind-merge drops a `leading-*` that
          // precedes a font-size class, which left the headline at the body's 1.5.
          cn(
            "font-heading font-bold tracking-[-0.025em] text-foreground",
            layout === "preview"
              ? "text-[clamp(28px,4vw,44px)]"
              : mobile
                ? "text-[30px]"
                : "text-[44px]",
            "leading-[1.08]",
          ),
          vals.headline,
        )}
        {target("sub", "max-w-[460px] text-base leading-[1.55] text-ink-2", vals.sub)}
        {target(
          "cta",
          "flex h-[46px] items-center rounded-md px-[22px] text-[15px] font-extrabold text-white",
          vals.cta,
          { background: vals.ctaBg },
        )}
        {target("trust", "text-[12.5px] text-ink-3", vals.trust)}
      </div>
      {target(
        "image",
        cn(
          "flex min-h-[240px] min-w-0 items-center justify-center self-stretch rounded-lg bg-cover bg-center p-4",
          layout === "preview" ? "flex-[1_1_320px]" : "w-full flex-1",
        ),
        <span className="max-w-full rounded-sm bg-white px-2 py-1 text-center font-mono text-xs break-all text-ink-3">
          {vals.image}
        </span>,
        {
          background: img
            ? `center / cover no-repeat url(${JSON.stringify(img)}), ${STRIPES}`
            : STRIPES,
        },
      )}
    </div>
  );
}

/** The mock site's header row: brand on the left, nav (editor) or a note (preview) on the right. */
export function MockSiteHeader({ brand, right }: { brand: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#F0F1F5] px-7 py-4">
      <span className="text-base font-extrabold tracking-[-0.01em]">{brand}</span>
      {right ?? (
        <div className="flex gap-4 text-[12.5px] text-ink-3">
          <span>Product</span>
          <span>Pricing</span>
          <span>Customers</span>
        </div>
      )}
    </div>
  );
}
