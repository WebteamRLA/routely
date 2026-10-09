import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

/** Inline field error (12.5px 600 red); renders nothing when empty. */
export function FieldError({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <span role="alert" className={cn("text-[12.5px] font-semibold text-danger-text", className)}>
      {children}
    </span>
  );
}

/** Label (13px 800) + control + error (12.5px 600 red) + help (12.5px grey). */
export function FormField({
  label,
  optional,
  error,
  help,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  optional?: boolean;
  error?: string | null;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-extrabold">
        {label}
        {optional ? <span className="font-medium text-ink-3"> · optional</span> : null}
      </label>
      {children}
      <FieldError>{error}</FieldError>
      {help ? <span className="text-[12.5px] text-ink-3">{help}</span> : null}
    </div>
  );
}

const control =
  "w-full min-w-0 rounded-md border bg-card px-3 text-[14px] text-foreground outline-none placeholder:text-faint focus:border-brand focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-ink-3";

type InputSize = "sm" | "md" | "lg";
const H: Record<InputSize, string> = { sm: "h-9", md: "h-10", lg: "h-[42px]" };

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    invalid?: boolean;
    mono?: boolean;
    inputSize?: InputSize;
  }
>(function TextInput({ invalid, mono, inputSize = "lg", className, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        control,
        H[inputSize],
        invalid ? "border-danger" : "border-input",
        mono && "font-mono text-[13px]",
        className,
      )}
      {...props}
    />
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function TextArea({ invalid, className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        control,
        "resize-y rounded-lg px-3 py-2.5",
        invalid ? "border-danger" : "border-input",
        className,
      )}
      {...props}
    />
  );
});

export const SelectInput = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; inputSize?: InputSize }
>(function SelectInput({ invalid, inputSize = "lg", className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        control,
        H[inputSize],
        "cursor-pointer px-2.5 text-[13.5px]",
        invalid ? "border-danger" : "border-input",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
