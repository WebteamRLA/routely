import { Shimmer } from "@/components/rl";

export default function SettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Shimmer className="h-7 w-40" />
        <Shimmer className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-5 nav:flex-row">
        <div className="flex gap-1 nav:w-[220px] nav:flex-col">
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} className="h-[38px] w-32 nav:w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Shimmer className="h-[260px]" />
          <Shimmer className="h-[180px]" />
        </div>
      </div>
    </div>
  );
}
