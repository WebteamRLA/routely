import { DashboardSkeleton } from "@/components/dashboard/dashboard-states";
import { Shimmer } from "@/components/rl";

/** Dashboard skeleton: header placeholders, four KPI tiles and the table block. */
export default function DashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2.5">
        <Shimmer className="h-3 w-44 rounded-sm" />
        <Shimmer className="h-7 w-80 max-w-full rounded-md" />
        <Shimmer className="h-4 w-96 max-w-full rounded-sm" />
      </div>
      <DashboardSkeleton />
    </div>
  );
}
