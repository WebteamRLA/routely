"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/rt/icons";
import { cn } from "@/lib/utils";

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";

/**
 * The invite page's buttons, in the Login screen's style: `primary` is the accent fill, `outline` is
 * the Login screen's white "Continue with Google" button. Shows a spinner and `pendingLabel` while
 * its form is in flight.
 */
export function InviteSubmitButton({
  variant,
  icon,
  label,
  pendingLabel,
}: {
  variant: "primary" | "outline";
  icon?: ReactNode;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-lg px-4 text-[15px] font-medium transition-[background,border-color] duration-[120ms] disabled:cursor-progress",
        variant === "primary"
          ? "border-0 bg-[#0070C9] font-semibold text-white shadow-[0_1px_2px_#11182714] hover:enabled:brightness-[.8]"
          : "border border-[#D1D5DB] bg-white text-[#111827] hover:enabled:border-[#C5C9D0] hover:enabled:bg-[#F9FAFB]",
        focusRing,
      )}
    >
      {pending ? (
        <Spinner
          size={20}
          className={cn("flex-none", variant === "primary" ? "text-white" : "text-[#0070C9]")}
        />
      ) : icon ? (
        <span aria-hidden className="inline-flex size-5 flex-none items-center justify-center">
          {icon}
        </span>
      ) : null}
      <span>{pending ? pendingLabel : label}</span>
    </button>
  );
}
