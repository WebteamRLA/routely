"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, isNavItemActive } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * Primary navigation, on the navy sidebar. Shared between the desktop sidebar and the mobile
 * drawer; `onNavigate` lets the drawer close itself after a link is followed.
 *
 * Each item carries the design's small rotated-square marker: coral when active, a faint
 * outline tone otherwise, so the current page is marked by shape as well as by colour.
 */
export function SidebarNav({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className={cn("flex flex-col gap-0.5", className)}>
      <div className="px-2.5 pb-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-white/45">
        WORKSPACE
      </div>
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[38px] items-center gap-2.5 rounded-md px-2.5 text-sm font-semibold no-underline",
              "transition-colors outline-none focus-visible:ring-3 focus-visible:ring-primary/40",
              active
                ? "bg-white/10 text-white hover:text-white"
                : "text-white/70 hover:bg-white/5 hover:text-white hover:no-underline",
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rotate-45", active ? "bg-coral" : "bg-white/25")}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
