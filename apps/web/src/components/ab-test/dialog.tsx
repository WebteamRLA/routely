"use client";

import type { ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The design's dialog shell with a configurable stacking level.
 *
 * Not the kit's `Modal`: this screen layers dialogs over its full-screen visual editor (z 85) —
 * the discard and remove confirmations sit at z 95 — while the kit's overlay is fixed at z 80.
 * Radix still supplies the focus trap, Escape and the aria wiring; `busy` ignores both while a
 * request is in flight, as the reference does.
 */
export function AbDialog({
  open,
  onClose,
  alert = false,
  busy = false,
  z = 80,
  width,
  className,
  children,
}: {
  open: boolean;
  onClose(): void;
  alert?: boolean;
  busy?: boolean;
  z?: number;
  width: number;
  className?: string;
  children: ReactNode;
}) {
  const P = alert ? AlertDialogPrimitive : DialogPrimitive;
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <P.Root open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <P.Portal>
        <P.Overlay
          className="fixed inset-0 flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4"
          style={{ zIndex: z }}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <P.Content
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault();
            }}
            className={cn(
              "relative flex w-full animate-[rt-dlg_.16s_ease-out] flex-col rounded-2xl border border-[#E5E7EB] bg-white text-[14px] leading-[1.45] text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none",
              className,
            )}
            style={{ maxWidth: width }}
          >
            {children}
          </P.Content>
        </P.Overlay>
      </P.Portal>
    </P.Root>
  );
}

export function AbDialogTitle({
  alert = false,
  className,
  children,
}: {
  alert?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const P = alert ? AlertDialogPrimitive : DialogPrimitive;
  return (
    <P.Title
      className={cn(
        "m-0 text-[16px] leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]",
        className,
      )}
    >
      {children}
    </P.Title>
  );
}

/** Title, body and a right-aligned action row: the design's small confirmation dialogs. */
export function ConfirmDialog({
  open,
  onClose,
  alert = false,
  busy = false,
  z,
  width,
  title,
  body,
  children,
}: {
  open: boolean;
  onClose(): void;
  alert?: boolean;
  busy?: boolean;
  z?: number;
  width: number;
  title: ReactNode;
  body: ReactNode;
  children: ReactNode;
}) {
  return (
    <AbDialog
      open={open}
      onClose={onClose}
      alert={alert}
      busy={busy}
      z={z}
      width={width}
      className="gap-5 p-6"
    >
      <div className="flex flex-col gap-1.5">
        <AbDialogTitle alert={alert}>{title}</AbDialogTitle>
        <p className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">{body}</p>
      </div>
      <DialogActions>{children}</DialogActions>
    </AbDialog>
  );
}

/** Buttons stretch to share the row on phones (`.rt-dlg-actions`). */
export function DialogActions({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex flex-wrap justify-end gap-2 max-[641px]:[&>button]:flex-auto", className)}
    >
      {children}
    </div>
  );
}
