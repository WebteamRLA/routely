import { ResultsLoading } from "@/components/results/results-states";
import { Shimmer } from "@/components/rl";

/** Header, tab row, then the verdict and chart shimmers — so the layout does not jump. */
export default function ExperimentDetailLoading() {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px]">
      <div className="flex flex-col gap-2.5">
        <Shimmer className="h-4 w-24 rounded-sm" />
        <div className="flex flex-wrap items-start justify-between gap-3.5">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
            <Shimmer className="h-[22px] w-48 rounded-sm" />
            <Shimmer className="h-7 w-full max-w-96 rounded-md" />
            <Shimmer className="h-4 w-full max-w-72 rounded-sm" />
          </div>
          <div className="flex gap-2">
            <Shimmer className="h-[38px] w-24 rounded-md" />
            <Shimmer className="h-[38px] w-28 rounded-md" />
          </div>
        </div>
      </div>
      <div className="flex gap-1 border-b border-border pb-3">
        {[0, 1, 2].map((t) => (
          <Shimmer key={t} className="h-4 w-16 rounded-sm" />
        ))}
      </div>
      <ResultsLoading />
    </div>
  );
}
