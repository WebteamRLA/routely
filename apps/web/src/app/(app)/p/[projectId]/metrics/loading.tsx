import { SettingsShellSkeleton } from "@/components/settings/settings-shell";
import { Shimmer } from "@/components/rl";

export default function MetricsLoading() {
  return (
    <SettingsShellSkeleton>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border">
        <Shimmer className="h-[76px] rounded-none" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Shimmer key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </SettingsShellSkeleton>
  );
}
