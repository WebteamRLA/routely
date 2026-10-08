"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { UnderlineTabs } from "@/components/rl";
import type { ExperimentStatusKey } from "@/lib/domain";

export type StatusFilter = ExperimentStatusKey | "all";

const TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "draft", label: "Draft" },
  { key: "completed", label: "Completed" },
  { key: "paused", label: "Paused" },
];

const SELECT =
  "h-9 cursor-pointer rounded-md border border-input bg-card px-2.5 text-[13.5px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-primary/15";

/**
 * Status tabs (with unfiltered counts), search, type and sort. Every control writes to the URL;
 * the page re-renders with `listForProject` applying the filters server-side.
 */
export function ListToolbar({
  counts,
  status,
  type,
  q,
  sort,
  onPending,
}: {
  counts: Record<StatusFilter, number>;
  status: StatusFilter;
  type: string;
  q: string;
  sort: string;
  onPending?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => onPending?.(pending), [pending, onPending]);
  // Follow the URL when it changes underneath (Clear filters, back/forward).
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setQuery(q);
  }
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function update(key: string, value: string, fallback: string) {
    const params = new URLSearchParams(search.toString());
    if (!value || value === fallback) params.delete(key);
    else params.set(key, value);
    params.delete("demo");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function onSearch(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update("q", value.trim(), ""), 250);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
      <UnderlineTabs
        ariaLabel="Filter by status"
        active={status}
        onSelect={(key) => update("status", key, "all")}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))}
      />
      <div className="flex max-w-full flex-wrap gap-2 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name or URL"
          aria-label="Search name or URL"
          className="h-9 w-[220px] max-w-full rounded-lg border border-input bg-card px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-brand focus:ring-3 focus:ring-primary/15"
        />
        <select
          aria-label="Type"
          value={type}
          onChange={(e) => update("type", e.target.value, "all")}
          className={SELECT}
        >
          <option value="all">All types</option>
          <option value="redirect">Split URL</option>
          <option value="ab">A/B test</option>
        </select>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => update("sort", e.target.value, "updated")}
          className={SELECT}
        >
          <option value="updated">Sort: Last updated</option>
          <option value="created">Sort: Newest</option>
          <option value="name">Sort: Name A–Z</option>
          <option value="visitors">Sort: Most visitors</option>
          <option value="cr">Sort: Conversion rate</option>
        </select>
      </div>
    </div>
  );
}
