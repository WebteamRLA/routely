import { DashboardSkeleton } from "@/components/dashboard/dashboard-states";
import { Shimmer } from "@/components/rl";

/** Dashboard skeleton: the header's title, buttons and project line, then the v2 loading blocks. */
export default function DashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Shimmer className="h-8 w-40 rounded-md" />
          <Shimmer className="h-9 w-[330px] max-w-full rounded-md" />
        </div>
        <Shimmer className="h-[30px] w-[420px] max-w-full rounded-[20px]" />
      </div>
      <DashboardSkeleton />
    </div>
  );
}
