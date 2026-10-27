import Link from "next/link";

import { focusRing } from "@/components/rt/styles";
import { type GuideAnchor, guideHref } from "@/lib/guides-types";
import { cn } from "@/lib/utils";

/**
 * A contextual "how does this work?" link into Help & Guides, by section anchor (so a renamed
 * section fails a test instead of leaving a dead link). Inside a flow — a wizard, a dialog — pass
 * `newTab` so reading the guide doesn't lose the user's place.
 */
export function HelpLink({
  anchor,
  children,
  newTab = false,
  className,
}: {
  anchor: GuideAnchor;
  children: React.ReactNode;
  newTab?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={guideHref(anchor)}
      {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
      className={cn(
        "inline-flex items-center gap-1 text-[13px] leading-[19px] font-medium text-[#0060AD] no-underline hover:underline",
        focusRing,
        className,
      )}
    >
      <svg
        aria-hidden
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-none"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" />
        <path d="M12 17h.01" />
      </svg>
      {children}
      {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </Link>
  );
}
