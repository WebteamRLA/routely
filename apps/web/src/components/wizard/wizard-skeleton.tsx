import { Shimmer } from "@/components/rl";

/** Loading state for the wizard routes: top bar, stepper and a form card. */
export function WizardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading experiment setup"
      className="mx-auto flex w-full max-w-[1240px] flex-col gap-[18px]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Shimmer className="h-[34px] w-[72px] rounded-md" />
          <div className="flex flex-col gap-2">
            <Shimmer className="h-3 w-32 rounded-sm" />
            <Shimmer className="h-5 w-56 rounded-sm" />
          </div>
        </div>
        <Shimmer className="h-9 w-24 rounded-md" />
      </div>
      <div className="hidden grid-cols-7 gap-1.5 nav:grid">
        {Array.from({ length: 7 }, (_, i) => (
          <Shimmer key={i} className="h-1 rounded-[2px]" />
        ))}
      </div>
      <div className="flex items-start gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Shimmer className="h-6 w-64 rounded-sm" />
          <Shimmer className="h-[280px]" />
        </div>
        <Shimmer className="hidden h-[320px] w-[290px] min-[1180px]:block" />
      </div>
    </div>
  );
}
