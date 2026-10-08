"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

import { DashboardErrorCard } from "@/components/dashboard/dashboard-states";

/** Dashboard error boundary: the design's "COULDN'T LOAD DASHBOARD" card; the shell stays. */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error("[routely] dashboard error", error);
  }, [error]);
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
      <DashboardErrorCard
        onRetry={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      />
    </div>
  );
}
