import Image from "next/image";
import Link from "next/link";

import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The product wordmark: the Routely mark beside the name.
 *
 * `size="lg"` is the standalone treatment used on unauthenticated screens, where the mark is
 * the only branding on the page; `sm` is the dashboard chrome's, at the design's 25×28.
 *
 * The image is decorative (`alt=""`) — the visible "Routely" beside it is the accessible name.
 */
export function Brand({
  className,
  href = routes.dashboard,
  size = "sm",
}: {
  className?: string;
  href?: string;
  size?: "sm" | "lg";
}) {
  const large = size === "lg";

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center rounded-md font-semibold tracking-[-0.01em] text-[#111827] no-underline",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
        large ? "gap-3 text-xl" : "gap-[9px] text-base",
        className,
      )}
    >
      <Image
        src="/routely-mark.png"
        alt=""
        width={large ? 36 : 25}
        height={large ? 40 : 28}
        // Above the fold on every page that shows it. `unoptimized` serves the 75×84 source as
        // is: it is already 3× the chrome size, and the optimizer would only re-encode it.
        loading="eager"
        unoptimized
        className="block shrink-0"
      />
      Routely
    </Link>
  );
}
