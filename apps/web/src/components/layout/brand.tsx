import Link from "next/link";

import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The design's logo mark: two rectangles, brand blue and coral — the two arms of a split.
 * Drawn in markup rather than shipped as an image so it stays crisp at every size.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-6 shrink-0 overflow-hidden rounded-md", className)}>
      <span className="flex-1 bg-brand" />
      <span className="flex-1 bg-coral" />
    </span>
  );
}

/**
 * The product wordmark.
 *
 * `size="lg"` is the standalone treatment used on unauthenticated screens; `sm` is the inline
 * treatment for the dashboard chrome. `tone="light"` is for the navy surfaces.
 */
export function Brand({
  className,
  href = routes.home,
  size = "sm",
  tone = "dark",
}: {
  className?: string;
  href?: string;
  size?: "sm" | "lg";
  tone?: "dark" | "light";
}) {
  const large = size === "lg";

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md font-heading tracking-[-0.01em] no-underline hover:no-underline",
        "outline-none focus-visible:ring-3 focus-visible:ring-primary/30",
        tone === "light" ? "text-white hover:text-white" : "text-foreground hover:text-foreground",
        large ? "text-xl font-bold" : "text-[19px] font-semibold",
        className,
      )}
    >
      <BrandMark />
      Routely
    </Link>
  );
}
