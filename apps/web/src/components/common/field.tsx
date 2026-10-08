import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A labelled form field with optional help text and server-side error messages.
 *
 * Wiring the ids here — `aria-describedby` pointing at both the hint and the error, and
 * `aria-invalid` set from the presence of errors — means every form gets the same accessible
 * behaviour without each one remembering to do it.
 */
export function Field({
  name,
  label,
  hint,
  errors,
  children,
  className,
  id: idOverride,
  required = false,
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  errors?: string[];
  /** Receives the props the input must spread to be described by the label and messages. */
  children: (props: {
    id: string;
    name: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
  }) => ReactNode;
  className?: string;
  /** Overrides the derived `field-${name}` id — needed when the same `name` repeats, as with a
   * dynamic list of same-named inputs (e.g. several "variantUrl" rows). */
  id?: string;
  /**
   * Marks the field as required in the label.
   *
   * Only the visual mark lives here — the input still carries its own `required`, which is
   * what assistive technology announces and what the browser enforces. Duplicating that as
   * `aria-required` on the label would make a screen reader say it twice, so the asterisk is
   * `aria-hidden` and exists for sighted users alone.
   */
  required?: boolean;
}) {
  const id = idOverride ?? `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden className="text-destructive">
            *
          </span>
        ) : null}
      </Label>

      {children({
        id,
        name,
        "aria-describedby": describedBy,
        "aria-invalid": errors?.length ? true : undefined,
      })}

      {errors?.length ? (
        <p id={errorId} className="text-[12.5px] font-semibold text-danger-text">
          {errors.join(" ")}
        </p>
      ) : null}

      {hint ? (
        <p id={hintId} className="text-[12.5px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
