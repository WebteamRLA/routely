"use client";

import Link from "next/link";

import { Diamond } from "@/components/rl";
import type { NavItem } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * The nav buttons: 6×6 rotated marker (coral when active), label, optional count pill. `size`
 * "drawer" is the mobile drawer's taller 44px / 15px variant (no counts there, as designed).
 */
export function NavList({
  items,
  size = "sidebar",
  onNavigate,
}: {
  items: NavItem[];
  size?: "sidebar" | "drawer";
  onNavigate?: () => void;
}) {
  const drawer = size === "drawer";
  return (
    <>
      {items.map((n) => (
        <Link
          key={n.label}
          href={n.href}
          onClick={onNavigate}
          aria-current={n.active ? "page" : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 text-left font-semibold no-underline outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-primary/40",
            drawer ? "h-11 text-[15px]" : "h-[38px] text-sm",
            n.active
              ? "bg-white/9 text-white hover:text-white"
              : "bg-transparent text-white/68 hover:text-white",
          )}
        >
          <Diamond size={6} className={n.active ? undefined : "bg-transparent"} />
          <span className="min-w-0 flex-1 truncate">{n.label}</span>
          {!drawer && n.count !== undefined ? (
            <span className="rounded-[20px] bg-white/10 px-[7px] py-0.5 text-[11.5px] font-bold text-white/85">
              {n.count}
            </span>
          ) : null}
        </Link>
      ))}
    </>
  );
}
