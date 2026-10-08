import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The building blocks every wizard step renders with: an intro (Sora heading plus one line of
 * context) above one or more white section cards.
 *
 * Navigation is not here any more. Back / Continue live in the wizard's sticky footer, so they
 * sit in the same place on every step instead of moving with the height of each step's body.
 */
export function StepIntro({
  title,
  description,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      {eyebrow ? (
        <p className="mb-1.5 text-xs font-extrabold tracking-[0.08em] text-coral uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mb-1.5 font-heading text-xl font-bold tracking-[-0.015em] text-pretty">
        {title}
      </h2>
      {description ? <p className="text-sm text-pretty text-ink-3">{description}</p> : null}
    </div>
  );
}

/** A white step-body card: 1px border, 8px radius. `padded` gives the design's 22px inset. */
export function WizardSection({
  children,
  title,
  meta,
  padded = true,
  className,
}: {
  children: ReactNode;
  /** Optional Sora 14.5px heading, rendered inside the padding. */
  title?: ReactNode;
  meta?: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-border bg-card",
        padded ? "flex flex-col gap-[18px] p-[18px] sm:p-[22px]" : "overflow-hidden",
        className,
      )}
    >
      {title ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h3 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">{title}</h3>
          {meta ? <span className="text-[12.5px] text-ink-3">{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The design's bold 13px field label, with an optional muted suffix ("· optional"). */
export function FieldLabel({
  htmlFor,
  children,
  suffix,
  required = false,
}: {
  htmlFor?: string;
  children: ReactNode;
  suffix?: ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-extrabold">
      {children}
      {required ? (
        <span aria-hidden className="text-danger-text">
          {" "}
          *
        </span>
      ) : null}
      {suffix ? <span className="font-medium text-ink-3"> · {suffix}</span> : null}
    </label>
  );
}

/** Inline field error: 12.5px, 600, #B4361F. */
export function FieldError({ id, messages }: { id?: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p id={id} className="text-[12.5px] font-semibold text-danger-text">
      {messages.join(" ")}
    </p>
  );
}

/** Help text under a field. */
export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-[12.5px] leading-normal text-ink-3">
      {children}
    </p>
  );
}

/**
 * The 42px input styling the wizard uses for its URL and name fields. The red border comes from
 * `aria-invalid`, which the inputs set whenever an error is showing for them.
 */
export const WIZARD_INPUT =
  "h-[42px] rounded-md border-input px-3 text-sm aria-invalid:border-danger aria-invalid:ring-0 aria-invalid:focus-visible:ring-3 aria-invalid:focus-visible:ring-danger/15";

export const WIZARD_URL_INPUT = cn(WIZARD_INPUT, "font-mono text-[13.5px]");
