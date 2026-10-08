"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "@/lib/utils";

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/** Closes a dropdown on a pointer-down outside `ref` or on Escape (the design's click-away). */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

/** Dropdown panel (design L743): white, 8px radius, soft navy shadow, right-aligned. */
export function MenuPanel({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      role="menu"
      className={cn(
        "absolute right-0 z-30 rounded-lg border border-border bg-card p-1 shadow-[0_12px_32px_rgba(10,22,51,0.14)]",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * The design's "⋯" row menu: 30×30 trigger, white dropdown (190px) right-aligned under it.
 * Clicks inside never bubble to a clickable row.
 */
export function RowMenu({
  items,
  label = "Actions",
  width = 190,
  className,
}: {
  items: MenuItem[];
  label?: string;
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  return (
    <div
      ref={ref}
      className={cn("relative flex justify-end", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="size-[30px] cursor-pointer rounded-md border border-transparent bg-transparent text-base font-extrabold text-ink-2 outline-none hover:bg-divider focus-visible:ring-3 focus-visible:ring-primary/30"
      >
        ⋯
      </button>
      {open ? (
        <MenuPanel className="top-[34px]" style={{ width }}>
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "block w-full cursor-pointer rounded-sm border-0 bg-transparent px-2.5 py-2 text-left text-[13.5px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
                item.tone === "danger" ? "text-danger-text" : "text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </MenuPanel>
      ) : null}
    </div>
  );
}
