"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { menuSurface } from "@/components/rt/styles";
import { cn } from "@/lib/utils";

/**
 * An anchored dropdown (row "⋮" menus, split-button menus, filter pickers).
 *
 * Render it inside a `relative` wrapper next to its trigger and control `open` from the parent.
 * It closes on an outside pointerdown and on Escape — which also returns focus to the trigger —
 * and focuses its first `[role=menuitem]`/`[role=option]` when it opens, so keyboard users land
 * inside it.
 */
export function PopoverMenu({
  open,
  onClose,
  triggerRef,
  label,
  role = "menu",
  align = "right",
  className,
  children,
}: {
  open: boolean;
  onClose(): void;
  triggerRef: React.RefObject<HTMLElement | null>;
  label: string;
  role?: "menu" | "listbox" | "dialog";
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    ref.current
      ?.querySelector<HTMLElement>('[role="menuitem"],[role="menuitemradio"],[role="option"],input')
      ?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, triggerRef]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className={cn(
        menuSurface,
        "absolute top-[calc(100%+4px)]",
        align === "right" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
