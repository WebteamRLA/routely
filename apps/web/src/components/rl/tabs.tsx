import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
  /** Link tabs (route/query driven); omit and pass `onSelect` for in-page tabs. */
  href?: string;
}

/**
 * Underline tabs: 2px blue underline on the active tab, optional count chip. `md` is the page
 * tab (40px, 13.5px 700); `sm` the results-chart metric tab (38px, 13px 800).
 */
export function UnderlineTabs({
  tabs,
  active,
  onSelect,
  size = "md",
  className,
  ariaLabel,
}: {
  tabs: TabItem[];
  active: string;
  onSelect?: (key: string) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex max-w-full gap-1 overflow-x-auto", className)}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        const cls = cn(
          "flex shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 bg-transparent whitespace-nowrap no-underline outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-primary/30",
          size === "md"
            ? "h-10 px-3 text-[13.5px] font-bold"
            : "h-[38px] px-2.5 text-[13px] font-extrabold",
          on
            ? "border-brand text-foreground hover:text-foreground"
            : "border-transparent text-ink-3 hover:text-foreground",
        );
        const inner = (
          <>
            {t.label}
            {t.count !== undefined ? (
              <span className="rounded-lg bg-divider px-1.5 py-px text-[11.5px] text-ink-2">
                {t.count}
              </span>
            ) : null}
          </>
        );
        return t.href ? (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={on}
            className={cls}
            scroll={false}
          >
            {inner}
          </Link>
        ) : (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            className={cls}
            onClick={() => onSelect?.(t.key)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** Settings tabs: vertical list on desktop, horizontal scroller below 900px. */
export function SideTabs({
  tabs,
  active,
  className,
}: {
  tabs: (TabItem & { href: string })[];
  active: string;
  className?: string;
}) {
  return (
    <nav className={cn("flex gap-1 overflow-x-auto nav:flex-col nav:overflow-visible", className)}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-[38px] shrink-0 items-center rounded-md border px-3 text-[13.5px] whitespace-nowrap text-foreground no-underline hover:text-foreground hover:no-underline",
              on
                ? "border-border bg-card font-extrabold"
                : "border-transparent font-semibold hover:bg-card/60",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
