import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { TrackingStatus } from "@/lib/pixel-status";
import { cn } from "@/lib/utils";

const PILL_CLASSES =
  "h-auto gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold [&>svg]:size-4!";

/**
 * A website's tracking status.
 *
 * Wording comes from `trackingStatus()` (`lib/pixel-status.ts`), so this can never disagree with
 * the same status rendered elsewhere.
 *
 * Pass `href` to make it a link — used as a shortcut back to the Get started guide.
 */
export function PixelStatusBadge({ status, href }: { status: TrackingStatus; href?: string }) {
  const { label } = status;
  const positive = status.state === "active";

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        PILL_CLASSES,
        positive
          ? "border-emerald-300/70 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "border-amber-300/70 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-300",
      )}
    >
      {positive ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
      {label}
    </Badge>
  );

  if (!href) {
    return badge;
  }

  return (
    <Link
      href={href}
      className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {badge}
    </Link>
  );
}
