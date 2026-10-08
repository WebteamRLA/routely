import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the design's loading state for experiment detail: the title block, the tab row, then
 * the two shimmer blocks standing in for the verdict hero and the comparison table — so the
 * layout does not jump when the aggregation queries return.
 */
export default function ExperimentLoading() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-24 rounded-md" />
        <div className="flex flex-wrap items-start justify-between gap-3.5">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
            <Skeleton className="h-[22px] w-40 rounded-md" />
            <Skeleton className="h-7 w-full max-w-80 rounded-md" />
            <Skeleton className="h-4 w-full max-w-64 rounded-md" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-[38px] w-24 rounded-md" />
            <Skeleton className="h-[38px] w-28 rounded-md" />
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {[0, 1, 2].map((tab) => (
          <div key={tab} className="flex h-10 items-center px-3.5">
            <Skeleton className="h-3.5 w-16 rounded-sm" />
          </div>
        ))}
      </div>

      <Skeleton className="h-[140px] w-full" />
      <Skeleton className="h-[340px] w-full" />
    </div>
  );
}
