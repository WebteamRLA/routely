"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The design's modal shell: navy-tinted overlay, white 10px panel, Escape and backdrop close
 * (unless `locked`), focus moved into the panel and restored on close.
 */
export function Modal({
  open,
  onClose,
  children,
  width = 520,
  label,
  locked = false,
  padded = true,
  dismissOnBackdrop = true,
  z = 97,
  className,
  overlayClassName,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  label: string;
  /** Ignore backdrop clicks and Escape (e.g. while launching). */
  locked?: boolean;
  padded?: boolean;
  /** False: only Escape (or the modal's own buttons) close it, not a backdrop click. */
  dismissOnBackdrop?: boolean;
  z?: number;
  className?: string;
  overlayClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !locked) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, locked, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-[rgba(10,22,51,0.55)] p-4",
        overlayClassName,
      )}
      style={{ zIndex: z }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked && dismissOnBackdrop) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "flex max-h-full w-full animate-rl-in flex-col overflow-auto rounded-xl bg-card text-foreground shadow-[0_24px_60px_rgba(0,0,0,0.3)] outline-none",
          padded && "gap-3.5 p-6",
          className,
        )}
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Modal heading (Sora 19px) and its body copy, which sits one panel gap (14px) below at a 1.5
 * line height. The design sets the confirmations about an experiment, cache or connection in
 * 600 and the project/session ones in 700, hence `weight`.
 */
export function ModalTitle({
  eyebrow,
  title,
  children,
  weight = 700,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  weight?: 600 | 700;
}) {
  return (
    <div>
      {eyebrow ? (
        <div className="mb-1.5 text-[12px] font-extrabold tracking-[0.08em] text-coral uppercase">
          {eyebrow}
        </div>
      ) : null}
      <h2
        className={cn("font-heading text-[19px]", weight === 600 ? "font-semibold" : "font-bold")}
      >
        {title}
      </h2>
      {children ? (
        <div className="mt-3.5 text-[14px] leading-[1.5] text-ink-2">{children}</div>
      ) : null}
    </div>
  );
}

export function ModalActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap justify-end gap-2", className)}>{children}</div>;
}

/**
 * Confirmation modal (delete, end, purge, disconnect, discard …). `tone` picks the confirm
 * button: danger (solid red), dark (navy) or primary.
 */
export function ConfirmModal({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  tone = "danger",
  pending = false,
  disabled = false,
  children,
  extraActions,
  titleWeight = 700,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  tone?: "danger" | "dark" | "primary";
  pending?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  /** Extra buttons placed between Cancel and the confirm button. */
  extraActions?: ReactNode;
  titleWeight?: 600 | 700;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={typeof title === "string" ? title : "Confirm"}
      locked={pending}
    >
      <ModalTitle title={title} weight={titleWeight}>
        {body}
      </ModalTitle>
      {children}
      <ModalActions>
        <Button variant="outline" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {extraActions}
        <Button
          size="lg"
          variant={tone === "danger" ? "destructive" : tone === "dark" ? "dark" : "default"}
          onClick={onConfirm}
          disabled={pending || disabled}
        >
          {confirmLabel}
        </Button>
      </ModalActions>
    </Modal>
  );
}
