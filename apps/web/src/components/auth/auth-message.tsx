"use client";

import Link from "next/link";

import { AuthShell, authFocusRing } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";

/** A one-message account screen in the Login style: heading, a sentence, one way onward. */
export function AuthMessage({
  title,
  description,
  action,
  supportEmail,
}: {
  title: string;
  description: string;
  action: { href: string; label: string };
  supportEmail: string | null;
}) {
  return (
    <AuthShell title={title} description={description} supportEmail={supportEmail} footnote="none">
      <Link
        href={action.href}
        className={cn(
          "flex h-12 w-full items-center justify-center rounded-lg bg-[#0070C9] px-4 text-[15px] font-semibold text-white no-underline hover:brightness-[.85]",
          authFocusRing,
        )}
      >
        {action.label}
      </Link>
    </AuthShell>
  );
}
