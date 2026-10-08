"use client";

import { usePathname, useRouter } from "next/navigation";

import { Shimmer } from "@/components/rl";
import { Button } from "@/components/ui/button";

/** Loading: four 118px tiles and a 320px block (DESIGN.md §2.2). */
export function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} className="h-[118px]" />
        ))}
      </div>
      <Shimmer className="h-80" />
    </>
  );
}

/** "COULDN'T LOAD DASHBOARD" with a navy "Try again". */
export function DashboardErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2.5 rounded-lg border border-danger-border bg-card px-7 py-9"
    >
      <div className="text-xs font-extrabold tracking-[0.08em] text-danger-text">
        COULDN&apos;T LOAD DASHBOARD
      </div>
      <div className="font-heading text-xl font-semibold">
        We couldn&apos;t reach the reporting service
      </div>
      <div className="max-w-[560px] text-ink-3">
        Your experiments are still running and collecting data — only this view failed to load. Try
        again in a moment.
      </div>
      <Button variant="dark" className="mt-1.5 px-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The dev-only `?demo=error` card: "Try again" drops the override. */
export function DemoDashboardError() {
  const router = useRouter();
  const pathname = usePathname();
  return <DashboardErrorCard onRetry={() => router.replace(pathname)} />;
}
