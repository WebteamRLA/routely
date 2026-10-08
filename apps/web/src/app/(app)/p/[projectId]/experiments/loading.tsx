import { ListSkeleton } from "@/components/experiments/list/list-skeleton";
import { Shimmer } from "@/components/rl";

export default function ExperimentsLoading() {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Shimmer className="h-7 w-40 rounded-md" />
          <Shimmer className="h-4 w-64 rounded-sm" />
        </div>
        <Shimmer className="h-10 w-40 rounded-md" />
      </div>
      <Shimmer className="h-10 w-full rounded-md" />
      <ListSkeleton />
    </div>
  );
}
