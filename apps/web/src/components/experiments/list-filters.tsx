"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Status tabs and name search for the experiments list.
 *
 * Both live in the URL so the view is bookmarkable and the server does the filtering — the
 * alternative, holding every experiment client-side and filtering there, gets slower exactly
 * as a customer accumulates tests.
 *
 * The search input is debounced: typing "checkout" would otherwise issue eight server round
 * trips, seven of which are thrown away.
 */

const DEBOUNCE_MS = 300;

export interface StatusTab {
  key: string;
  label: string;
  count: number;
}

export function ListFilters({
  tabs,
  status,
  search,
  children,
}: {
  tabs: StatusTab[];
  status: string;
  search: string;
  /** Further controls, e.g. the reporting-period picker, placed beside the search box. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [term, setTerm] = useState(search);

  // "Clear filters" navigates to a URL with no `q`; the box must empty with it. Adjusted during
  // render rather than in an effect, and only on the way to empty — syncing every change would
  // overwrite characters typed while the previous search was still in flight.
  const [lastSearch, setLastSearch] = useState(search);
  if (search !== lastSearch) {
    setLastSearch(search);
    if (search === "") setTerm("");
  }

  function push(next: URLSearchParams) {
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  function selectStatus(key: string) {
    const params = new URLSearchParams(searchParams);
    if (key === "all") params.delete("status");
    else params.set("status", key);
    push(params);
  }

  // Debounced, and skipped entirely when the term already matches the URL — otherwise the
  // effect would fire a redundant navigation on every render caused by the navigation itself.
  useEffect(() => {
    if (term === search) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (term.trim()) params.set("q", term.trim());
      else params.delete("q");
      push(params);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-border">
      <nav aria-label="Filter by status" className="-mb-px flex max-w-full gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.key === status;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectStatus(tab.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-[13.5px] font-bold whitespace-nowrap transition-colors",
                "outline-none focus-visible:bg-brand-tint",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-ink-3 hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="rounded-lg bg-divider px-1.5 py-px text-[11.5px] text-ink-2 tabular-nums">
                {tab.count}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex w-full flex-wrap items-center gap-2 py-2 sm:w-auto">
        <div className="relative min-w-0 flex-1 sm:w-[220px] sm:flex-none">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search experiments…"
            aria-label="Search experiments by name"
            className="h-9 rounded-lg pr-8 text-[13.5px]"
          />
          {isPending ? (
            <Loader2
              className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-ink-3"
              aria-hidden
            />
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
