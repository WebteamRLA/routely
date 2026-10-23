"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavItemActive, type NavItem } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * Primary navigation. The rows grow from 36px to 44px below 1200px, where the sidebar becomes a
 * touch drawer and 36px is under a comfortable tap target.
 *
 * Hover is an inset shadow rather than a background colour so it darkens whatever the row sits
 * on by the same amount, and so it can never be confused with the active row's fill.
 */
export function SidebarNav({
  items,
  label,
  className,
}: {
  items: NavItem[];
  label: string;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={cn("flex flex-col gap-0.5", className)}>
      {items.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm no-underline max-[1200px]:h-11",
              "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
              active
                ? "bg-[#F1F3F5] font-semibold text-[#111827]"
                : "font-medium text-[#374151] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]",
            )}
          >
            <Icon className={cn("shrink-0", !active && "stroke-[#6B7280]")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
