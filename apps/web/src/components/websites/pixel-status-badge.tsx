import Link from "next/link";

import { PIXEL_STATUS, type PixelStatus } from "@/lib/pixel-status";
import { cn } from "@/lib/utils";

/**
 * A website's tracking status.
 *
 * Wording and tone come from the shared `PIXEL_STATUS` table, so this can never disagree with
 * the same status rendered elsewhere — which is the bug this component previously had.
 *
 * Pass `href` to make it a link — used as a shortcut back to the Get started guide.
 */
export function PixelStatusBadge({ status, href }: { status: PixelStatus; href?: string }) {
  const { label, positive } = PIXEL_STATUS[status];

  const badge = (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm border px-3 text-[12.5px] font-extrabold whitespace-nowrap",
        positive
          ? "border-success-border bg-success-bg text-success-strong"
          : "border-danger-border bg-danger-bg-2 text-danger-text",
      )}
    >
      <span aria-hidden>{positive ? "✓" : "✕"}</span>
      {label}
    </span>
  );

  if (!href) {
    return badge;
  }

  return (
    <Link
      href={href}
      className="inline-flex rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-primary/15"
    >
      {badge}
    </Link>
  );
}
