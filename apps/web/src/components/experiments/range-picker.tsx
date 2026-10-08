"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, Loader2 } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DEFAULT_RANGE, RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/date-range";

/**
 * Reporting window selector.
 *
 * The selection lives in the URL rather than in component state, so the view is bookmarkable,
 * shareable and survives a refresh — and so the server, which does the aggregating, is the one
 * that reads it. `useTransition` keeps the old numbers on screen while the new ones load
 * instead of flashing a skeleton over data that is about to be replaced.
 */
/** Compact labels for the segmented form, where five full labels would not fit a phone. */
const SHORT_LABELS: Record<RangeKey, string> = {
  all: "All",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
};

export function RangePicker({
  value,
  variant = "select",
}: {
  value: RangeKey;
  /** `segmented` is the design's button group, used in the results hero. */
  variant?: "select" | "segmented";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(next: string) {
    const params = new URLSearchParams(searchParams);

    // The default is the absence of the parameter, so a plain URL stays plain.
    if (next === DEFAULT_RANGE) params.delete("range");
    else params.set("range", next);

    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  if (variant === "segmented") {
    return (
      <div className="flex items-center gap-2">
        {isPending ? <Loader2 className="size-3.5 animate-spin text-ink-3" aria-hidden /> : null}
        <div
          role="group"
          aria-label="Reporting period"
          className="flex overflow-hidden rounded-lg border border-input bg-card"
        >
          {RANGE_KEYS.map((key) => {
            const active = key === value;
            return (
              <button
                key={key}
                type="button"
                onClick={() => select(key)}
                aria-pressed={active}
                title={RANGE_LABELS[key]}
                className={cn(
                  "h-8 cursor-pointer px-3 text-[12.5px] font-bold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-primary/15 focus-visible:ring-inset",
                  active ? "bg-navy text-white" : "text-foreground hover:bg-divider",
                )}
              >
                {SHORT_LABELS[key]}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isPending ? <Loader2 className="size-3.5 animate-spin text-ink-3" aria-hidden /> : null}
      <Select value={value} onValueChange={select}>
        <SelectTrigger
          className="h-9! w-[10.5rem] rounded-md text-[13.5px]"
          aria-label="Reporting period"
        >
          <CalendarRange className="size-3.5 text-ink-3" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {RANGE_KEYS.map((key) => (
            <SelectItem key={key} value={key}>
              {RANGE_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
