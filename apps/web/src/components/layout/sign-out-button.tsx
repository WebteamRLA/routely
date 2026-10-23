"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { LogOutIcon } from "@/components/layout/nav-icons";
import { cn } from "@/lib/utils";

/**
 * The account menu's "Log out" item.
 *
 * Rendered as the enclosing form's submit button, so signing out is a plain form submission to
 * a Server Action — no client-side session library involved. `useFormStatus` needs to be inside
 * the form, which is why this is its own component rather than markup in the menu.
 */
export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      role="menuitem"
      disabled={pending}
      className={cn(
        "flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-white px-2.5 text-left",
        "text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
        "disabled:cursor-default disabled:opacity-45",
      )}
    >
      {pending ? (
        <Loader2 className="size-[18px] shrink-0 animate-spin" aria-hidden />
      ) : (
        <LogOutIcon className="shrink-0" />
      )}
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
