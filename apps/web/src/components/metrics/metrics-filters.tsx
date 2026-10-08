"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Tabs, search, sort and type filter for the metrics list.
 *
 * Everything lives in the URL, so the view is bookmarkable and the filtering happens in the
 * database — the same choice the experiments list makes, and for the same reason: holding
 * every row client-side gets slower exactly as a customer accumulates goals.
 */

const DEBOUNCE_MS = 300;

export interface MetricTab {
  key: string;
  label: string;
  count: number;
}

export function MetricsFilters({
  tabs,
  tab,
  search,
  type,
  sort,
  types,
  total,
}: {
  tabs: MetricTab[];
  tab: string;
  search: string;
  type: string;
  sort: string;
  types: { key: string; label: string }[];
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [term, setTerm] = useState(search);

  function push(next: URLSearchParams) {
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  function set(key: string, value: string, fallback: string) {
    const params = new URLSearchParams(searchParams);
    if (value === fallback) params.delete(key);
    else params.set(key, value);
    push(params);
  }

  // Debounced, and skipped when the term already matches the URL — otherwise the effect fires
  // a redundant navigation on every render the navigation itself caused.
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
    <div className="border-b border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-divider px-3 sm:px-5">
        <div className="flex max-w-full gap-1 overflow-x-auto">
          {tabs.map((item) => {
            const active = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => set("tab", item.key, "summary")}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-10 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-[13.5px] font-bold whitespace-nowrap transition-colors",
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-ink-3 hover:text-foreground",
                )}
              >
                {item.label}
                <span className="rounded-lg bg-divider px-1.5 py-px text-[11.5px] text-ink-2 tabular-nums">
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
        <span className="flex items-center gap-2 py-2 text-[12.5px] text-ink-3 tabular-nums">
          {isPending ? (
            <span
              aria-hidden
              className="size-3.5 animate-rl-spin rounded-full border-2 border-brand-tint-2 border-t-primary"
            />
          ) : null}
          {total} {total === 1 ? "metric" : "metrics"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-5">
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search name or URL"
          aria-label="Search metrics"
          className="h-9 w-full min-w-0 sm:w-[240px]"
        />

        <Select value={type} onValueChange={(value) => set("type", value, "all")}>
          <SelectTrigger className="data-[size=default]:h-9" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(value) => set("sort", value, "recent")}>
          <SelectTrigger className="data-[size=default]:h-9" aria-label="Sort metrics">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Sort: Most recent</SelectItem>
            <SelectItem value="conversions">Sort: Most conversions</SelectItem>
            <SelectItem value="name">Sort: Name A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
