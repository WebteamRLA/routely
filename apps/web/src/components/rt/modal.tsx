"use client";

import type { ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from "radix-ui";

import { XIcon } from "@/components/rt/icons";
import { btn } from "@/components/rt/styles";
import { cn } from "@/lib/utils";

/**
 * The design's modal: a dimmed backdrop and a white 16px-radius panel that rises in.
 *
 * Built on the Radix primitives directly rather than `ui/dialog`, whose built-in close button,
 * blurred overlay and zoom animation would all need overriding. Radix still supplies the focus
 * trap, Escape and the aria wiring. `busy` locks the modal while a submit is in flight — Escape
 * and backdrop clicks are ignored — matching the reference.
 *
 * Children mount only while open, so a reopened modal always starts from fresh state.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  alert = false,
  width = 560,
  className,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Accessible name. Pass `null` when the content renders its own `ModalTitle`. */
  title: ReactNode | null;
  description?: ReactNode;
  busy?: boolean;
  /** Destructive confirmations use role="alertdialog". */
  alert?: boolean;
  /** Max width in px (the design uses 460 / 560 / 600 / 680). */
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  const P = alert ? AlertDialogPrimitive : DialogPrimitive;
  const close = () => {
    if (!busy) onOpenChange(false);
  };

  return (
    <P.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <P.Portal>
        <P.Overlay
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4"
          // AlertDialog ignores backdrop clicks by default; the design closes on one.
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <P.Content
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault();
            }}
            // Without a description Radix warns unless the attribute is explicitly absent.
            {...(description ? {} : { "aria-describedby": undefined })}
            className={cn(
              "relative flex max-h-[calc(100vh-32px)] w-full animate-[rt-dlg_.16s_ease-out] flex-col overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white text-sm leading-[1.45] text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none",
              className,
            )}
            style={{ maxWidth: width }}
          >
            {title !== null ? (
              <ModalHeader title={title} description={description} onClose={close} alert={alert} />
            ) : null}
            {children}
          </P.Content>
        </P.Overlay>
      </P.Portal>
    </P.Root>
  );
}

/** Title + description + close button, padded 20px 24px 0 as in every reference dialog. */
export function ModalHeader({
  title,
  description,
  icon,
  onClose,
  alert = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Optional 36px tile left of the title (success tick, warning, trash…). */
  icon?: ReactNode;
  onClose?: () => void;
  alert?: boolean;
}) {
  const P = alert ? AlertDialogPrimitive : DialogPrimitive;
  return (
    <div className="flex items-start gap-3 px-6 pt-5 max-[641px]:px-4">
      {icon}
      <div className="flex min-w-0 flex-auto flex-col gap-1">
        <P.Title className="m-0 text-base leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]">
          {title}
        </P.Title>
        {description ? (
          <P.Description className="m-0 text-sm leading-5 text-pretty text-[#4B5563]">
            {description}
          </P.Description>
        ) : null}
      </div>
      {onClose ? (
        <button type="button" aria-label="Close" onClick={onClose} className={btn.icon}>
          <XIcon />
        </button>
      ) : null}
    </div>
  );
}

export function ModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-4 px-6 py-5 max-[641px]:px-4", className)}>
      {children}
    </div>
  );
}

/** Right-aligned action row over a hairline; buttons go full-width and 44px tall on phones. */
export function ModalFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex justify-end border-t border-[#EEF0F3] px-6 py-4 max-[641px]:px-4",
        className,
      )}
    >
      <div className="flex flex-wrap gap-2 max-[641px]:w-full max-[641px]:[&>*]:h-11 max-[641px]:[&>*]:flex-auto">
        {children}
      </div>
    </div>
  );
}

/** A 36px tinted tile for a modal header icon. */
export function ModalIcon({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-9 flex-none items-center justify-center rounded-lg"
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  );
}
