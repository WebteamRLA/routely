import { Shimmer } from "@/components/rl";

export default function MetricsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Shimmer className="h-7 w-48" />
        <Shimmer className="h-4 w-80" />
      </div>
      <Shimmer className="h-10 w-72" />
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border">
        <Shimmer className="h-[76px] rounded-none" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Shimmer key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </div>
  );
}
