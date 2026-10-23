"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { Spinner } from "@/components/rt/icons";
import { btn, errorText, focusRing, help, input, label } from "@/components/rt/styles";
import { cn } from "@/lib/utils";

/** Settings' buttons: the kit's, without the primary's drop shadow and 44px tall on phones. */
export const sbtn = {
  primary: cn(btn.primary, "shadow-none max-[641px]:h-11"),
  secondary: cn(btn.secondary, "max-[641px]:h-11"),
  danger: cn(btn.danger, "max-[641px]:h-11"),
  dangerOutline: cn(btn.dangerOutline, "max-[641px]:h-11"),
  /** Inline text action ("Resend link", "Remove"); darkens on hover. */
  text: `inline-flex cursor-pointer items-center border-0 bg-transparent text-[13px] font-medium hover:!text-[#111827] ${focusRing}`,
};

/** A white settings card: titled header, a body, and an optional footer bar. */
export function SettingsCard({
  id,
  title,
  description,
  aside,
  headerClassName,
  titleClassName,
  children,
}: {
  id: string;
  title: ReactNode;
  description: ReactNode;
  aside?: ReactNode;
  headerClassName?: string;
  titleClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col rounded-xl border border-[#EEF0F3] bg-white"
    >
      <div
        className={cn(
          "flex px-6 pt-5 max-[641px]:px-4",
          aside ? "flex-wrap items-start justify-between gap-3" : "flex-col gap-0.5",
          headerClassName,
        )}
      >
        {aside ? (
          <>
            <div className={cn("flex min-w-0 flex-col gap-0.5", titleClassName)}>
              <CardTitle id={id} title={title} description={description} />
            </div>
            {aside}
          </>
        ) : (
          <CardTitle id={id} title={title} description={description} />
        )}
      </div>
      {children}
    </section>
  );
}

function CardTitle({
  id,
  title,
  description,
}: {
  id: string;
  title: ReactNode;
  description: ReactNode;
}) {
  const heading = (
    <h2 id={id} className="m-0 text-base leading-6 font-semibold text-[#111827]">
      {title}
    </h2>
  );
  const desc =
    typeof description === "string" ? (
      <p className="m-0 text-sm leading-5 text-pretty text-[#4B5563]">{description}</p>
    ) : (
      description
    );
  return (
    <>
      {heading}
      {desc}
    </>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-[18px] px-6 pt-[18px] pb-[22px] max-[641px]:px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The hairline footer with a status on the left and actions on the right. */
export function CardFooter({ status, children }: { status: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] px-6 py-3.5 max-[641px]:px-4">
      {status}
      {children ? (
        <div className="flex gap-2 max-[641px]:w-full max-[641px]:[&>button]:flex-auto">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** The live footer status ("Saving…", "Unsaved changes"), with a spinner while busy. */
export function FooterStatus({ busy, text }: { busy: boolean; text: string }) {
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-[13px] leading-[19px] text-[#6B7280]"
    >
      {busy ? <Spinner size={13} /> : null}
      {text}
    </span>
  );
}

/** Label, 40px input, and either the help line or the error in its place. */
export function Field({
  id,
  label: text,
  error,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  error: string;
  hint: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  const helpId = `${id}-help`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={label}>
        {text}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : false}
        aria-describedby={helpId}
        className={cn(input, "max-[641px]:h-11")}
        {...rest}
      />
      {error ? (
        <p id={helpId} role="alert" className={errorText}>
          {error}
        </p>
      ) : (
        <p id={helpId} className={help}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** The design's small destructive confirmation: title, body, Cancel + a red action. */
export function ConfirmDialog({
  open,
  title,
  body,
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  action: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const close = () => {
    if (!busy) onCancel();
  };
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(next) => (next ? null : close())}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <AlertDialogPrimitive.Content
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
            className="relative flex w-full max-w-[460px] animate-[rt-dlg_.16s_ease-out] flex-col gap-[18px] rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none motion-reduce:animate-none"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <AlertDialogPrimitive.Title className="m-0 text-base leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]">
                {title}
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">
                {body}
              </AlertDialogPrimitive.Description>
            </div>
            <div className="flex flex-wrap justify-end gap-2 max-[641px]:w-full max-[641px]:[&>button]:flex-auto">
              <button type="button" onClick={close} disabled={busy} className={sbtn.secondary}>
                Cancel
              </button>
              <button type="button" onClick={onConfirm} disabled={busy} className={sbtn.danger}>
                {busy ? <Spinner /> : null}
                {action}
              </button>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Overlay>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
